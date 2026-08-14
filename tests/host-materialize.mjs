/**
 * Dev-only verification of the preset materializer: boots the host plugin's
 * apply() against a fake context with DSH_HOME pointed at a temp directory,
 * then asserts the generated preset rows reference real built lib files and
 * the composition carries the WSL execution-world realm.
 *
 * Run from the plugin directory: `node tests/host-materialize.mjs`
 */

import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const home = mkdtempSync(join(tmpdir(), 'dsh-wsl-home-'))
process.env.DSH_HOME = home

const { apply } = require('../lib/index.js')

// ── fake roster: one standard-like and one minimal-like source preset ──────
const STANDARD_SRC = `# standard
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a coding agent powered by the {{model}} model.

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
`
const MINIMAL_SRC = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: You are a helpful software engineer assistant.
    complete: true

- id: persistent-shell
  name: cordis:group
  group: true
  isolate:
    terminals: true
  config:
    - id: pty
      name: '@deepseek-ai/dsh-terminal'
    - id: terminal-bash
      name: '@deepseek-ai/dsh-terminal-bash'
      config:
        timeoutMs: 300000
    - id: persistent-bash
      name: '@deepseek-ai/dsh-tool-bash-persistent'
      config:
        timeoutMs: 300000

- id: filesystem
  name: cordis:group
  group: true
  isolate:
    fs: true
  config:
    - id: fs-local
      name: '@deepseek-ai/dsh-fs-local'
    - id: str-replace-editor
      name: '@deepseek-ai/dsh-tool-str-replace-editor'
      config:
        maxOutputChars: 16000
`
const sources = {
  standard: { path: join(home, 'src-standard', 'agent.cordis.yml'), text: STANDARD_SRC },
  minimal: { path: join(home, 'src-minimal', 'agent.cordis.yml'), text: MINIMAL_SRC },
}
// Source display metadata with declared roster order (the shipped layout).
mkdirSync(join(home, 'src-standard'), { recursive: true })
mkdirSync(join(home, 'src-minimal'), { recursive: true })
writeFileSync(join(home, 'src-standard', 'preset.yml'), 'name: 标准模式\norder: 1\n', 'utf8')
writeFileSync(join(home, 'src-minimal', 'preset.yml'), 'name: 极简模式\norder: 3\n', 'utf8')
const registrations = []
const fakeCtx = {
  get: (key) => {
    if (key === 'webServer') return { register: (route) => { registrations.push(route); return () => {} } }
    if (key === 'agentPresets') return {
      list: async () => Object.entries(sources).map(([id, source]) => ({ id, path: source.path })),
      read: async (id) => sources[id].text,
    }
    // Optional services (shellEnv) degrade to absent in this harness.
    return undefined
  },
  effect: (fn) => { fn(); return () => {} },
}

// The legacy standalone `wsl` preset dir from an earlier plugin version must
// be removed: the execution world now folds into the mode variants.
mkdirSync(join(home, '.agent-presets', 'wsl'), { recursive: true })
writeFileSync(join(home, '.agent-presets', 'wsl', 'agent.cordis.yml'), '# legacy\n', 'utf8')

apply(fakeCtx, { route: '/wsl-workspace/api' })

const assert = (condition, label) => {
  if (!condition) throw new Error(`preset materialization: ${label}`)
  console.log(`ok: ${label}`)
}

assert(registrations.length === 1 && registrations[0].kind === 'exact' && registrations[0].path === '/wsl-workspace/api', 'route registered')

// ── variants: generated asynchronously by the apply effect ─────────────────
// Wait for the fire-and-forget generation to settle.
await new Promise(resolve => setTimeout(resolve, 300))

assert(!existsSync(join(home, '.agent-presets', 'wsl')), 'legacy standalone wsl preset removed')

const stdVariant = join(home, '.agent-presets', 'wsl-standard')
const stdYaml = readFileSync(join(stdVariant, 'agent.cordis.yml'), 'utf8')
const stdMeta = readFileSync(join(stdVariant, 'preset.yml'), 'utf8')
assert(existsSync(stdVariant), 'wsl-standard variant generated')
assert(existsSync(join(stdVariant, 'preset.yml')), 'wsl-standard metadata generated')
assert(stdMeta.includes('name: WSL · Standard mode'), 'shipped modes get English display names')
assert(stdMeta.includes('WSL execution world for Standard mode'), 'variant description is English')
assert(stdMeta.includes('order: 1'), 'variant inherits the source roster order')
assert(!/^- id: tool-pwsh$/m.test(stdYaml), 'variant drops pwsh row')
assert(!/^- id: tool-bash$/m.test(stdYaml), 'variant drops top-level bash row')
assert(!/^- id: tool-fs-search$/m.test(stdYaml), 'variant drops the grep tool (Windows rg cannot open Linux paths)')
assert(stdYaml.includes('- id: wsl-world'), 'variant injects wsl realm')
assert(stdYaml.includes('inside a WSL'), 'variant persona amended')
const shellRow = /name: '(.+shell\.js)'/.exec(stdYaml)
assert(shellRow !== null && existsSync(shellRow[1]), 'variant shell row points at a real lib file')

const minVariant = join(home, '.agent-presets', 'wsl-minimal')
const minYaml = readFileSync(join(minVariant, 'agent.cordis.yml'), 'utf8')
assert(existsSync(minVariant), 'wsl-minimal variant generated')
assert(!minYaml.includes('fs-local'), 'minimal variant drops fs-local')
assert(minYaml.includes('str-replace-editor'), 'minimal variant keeps the editor')
assert(minYaml.includes("shellPath: 'wsl.exe'"), 'minimal variant re-points PTY at wsl.exe')

// Stale variant cleanup: a wsl-ghost dir whose source vanished must go.
mkdirSync(join(home, '.agent-presets', 'wsl-ghost'), { recursive: true })
writeFileSync(join(home, '.agent-presets', 'wsl-ghost', 'agent.cordis.yml'), '- id: x\n', 'utf8')
// Rerun apply to exercise cleanup.
apply(fakeCtx, { route: '/wsl-workspace/api' })
await new Promise(resolve => setTimeout(resolve, 300))
assert(!existsSync(join(home, '.agent-presets', 'wsl-ghost')), 'stale variant cleaned up')
assert(existsSync(join(home, '.agent-presets', 'wsl-standard')), 'kept variant survives rerun')

rmSync(home, { recursive: true, force: true })
console.log('HOST MATERIALIZE PASSED')
