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

- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    directories:
      - .agents/skills
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

- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
`
const PREFAB_SRC = `# prefab-like source preset (win32-only custom bash + local fs group)
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: You are a helpful software engineer assistant.
    complete: true
    includeRuntimeContext: false

- id: custom-bash
  name: ./custom-bash.mjs
  disabled: !!js process.platform !== 'win32'
  config:
    bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe'

- id: bootstrap-filesystem
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
// DSH v0.1.3-alpha.2 renamed the persona's model-facing scalar: `text` became
// an inline `suffix` plus a folded `prefix`. A source in that shape must be
// amended too - the pre-0.4.3 matcher only looked for `text: >-` and silently
// dropped the WSL sentence (issue #22).
const SUFFIX_PREFIX_SRC = `# v0.1.3-alpha.2+ persona shape
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You are a coding agent powered by the {{model}} model.

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
`
// The new shape with the runtime-context opt-out: never amended.
const SUFFIX_COMPLETE_SRC = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You are a coding agent.
    complete: true
`

const sources = {
  standard: { path: join(home, 'src-standard', 'agent.cordis.yml'), text: STANDARD_SRC },
  minimal: { path: join(home, 'src-minimal', 'agent.cordis.yml'), text: MINIMAL_SRC },
  'third-party-local': { path: join(home, 'src-third-party', 'agent.cordis.yml'), text: PREFAB_SRC },
  'standard-new': { path: join(home, 'src-standard-new', 'agent.cordis.yml'), text: SUFFIX_PREFIX_SRC },
  'standard-new-complete': { path: join(home, 'src-standard-new-complete', 'agent.cordis.yml'), text: SUFFIX_COMPLETE_SRC },
}
// Source display metadata with declared roster order (the shipped layout).
mkdirSync(join(home, 'src-standard'), { recursive: true })
mkdirSync(join(home, 'src-minimal'), { recursive: true })
mkdirSync(join(home, 'src-third-party'), { recursive: true })
writeFileSync(join(home, 'src-standard', 'preset.yml'), 'name: 标准模式\norder: 1\n', 'utf8')
writeFileSync(join(home, 'src-minimal', 'preset.yml'), 'name: 极简模式\norder: 3\n', 'utf8')
writeFileSync(join(home, 'src-third-party', 'preset.yml'), 'name: Third Party Local\norder: 8\n', 'utf8')
mkdirSync(join(home, 'src-standard-new'), { recursive: true })
mkdirSync(join(home, 'src-standard-new-complete'), { recursive: true })
writeFileSync(join(home, 'src-standard-new', 'preset.yml'), 'name: New Shape\norder: 9\n', 'utf8')
writeFileSync(join(home, 'src-standard-new-complete', 'preset.yml'), 'name: New Shape Complete\norder: 10\n', 'utf8')
// A source preset is an opaque, self-contained unit. Assets must travel
// without the WSL plugin knowing their names, extensions, or consumers.
mkdirSync(join(home, 'src-third-party', 'plugin-data'), { recursive: true })
writeFileSync(join(home, 'src-third-party', 'plugin-data', 'trajectory.bin'), 'opaque preset data\n', 'utf8')
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
assert(stdMeta.includes("name: 'WSL · Standard mode（标准模式）'"), 'shipped modes get bilingual display names')
assert(stdMeta.includes("description: 'WSL execution world for Standard mode（标准模式）"), 'variant description is bilingual')
assert(stdMeta.includes('order: 1'), 'variant inherits the source roster order')
// Regression guard: a `: ` inside an unquoted plain scalar makes the whole
// preset.yml unparsable, silently dropping name/description/order.
const yaml = require('js-yaml')
const stdParsed = yaml.load(stdMeta)
assert(stdParsed !== null && typeof stdParsed === 'object', 'variant metadata parses as YAML')
assert(stdParsed.name === 'WSL · Standard mode（标准模式）', 'variant metadata name survives YAML parsing')
assert(typeof stdParsed.description === 'string' && stdParsed.description.includes('bash and file tools run inside'), 'variant metadata description survives YAML parsing')
assert(!/^- id: tool-pwsh$/m.test(stdYaml), 'variant drops pwsh row')
assert(!/^- id: tool-bash$/m.test(stdYaml), 'variant drops top-level bash row')
assert(!/^- id: tool-fs-search$/m.test(stdYaml), 'variant drops the grep tool (Windows rg cannot open Linux paths)')
assert(stdYaml.includes('- id: wsl-world'), 'variant injects wsl realm')
assert(stdYaml.includes('inside a WSL'), 'variant persona amended')
const shellRow = /name: '(.+shell\.js)'/.exec(stdYaml)
assert(shellRow !== null && existsSync(shellRow[1]), 'variant shell row points at a real lib file')

// ── skill catalog over UNC: the watcher must be off ───────────────────────
// A //wsl.localhost/... workspace cannot be watched by chokidar; the failed
// watcher makes the observation incomplete and withholds the whole catalog.
// The materializer therefore pins `watch: false` on the skill-filesystem row.
assert(stdYaml.includes('- id: skill-filesystem'), 'variant keeps the skill-filesystem row')
assert(
  /- id: skill-filesystem\n(?:.*\n)*?\s+config:\n\s+watch: false\n/.test(stdYaml),
  'skill watch is disabled as the first config child of a row that already had config',
)
assert(stdYaml.includes('directories:\n      - .agents/skills'), 'the row\'s pre-existing config survives the merge')
assert(!/watch: true/.test(stdYaml), 'no variant leaves the skill watcher enabled')

const newVariant = join(home, '.agent-presets', 'wsl-standard-new')
assert(existsSync(newVariant), 'v0.1.3+ persona-shape variant generated')
const newYaml = readFileSync(join(newVariant, 'agent.cordis.yml'), 'utf8')
assert(newYaml.includes('inside a WSL'), 'v0.1.3+ persona shape is amended (issue #22 guard)')
assert(
  /suffix: >-\n\s+Your working directory is \{\{cwd\}\}\.\n\s+Your working directory \{\{cwd\}\} is inside a WSL/.test(newYaml),
  'the note joins the suffix sentence it belongs to',
)
assert(newYaml.indexOf('inside a WSL') < newYaml.indexOf('prefix: >-'), 'the note stays in the suffix block, not the prefix')

const newCompleteVariant = join(home, '.agent-presets', 'wsl-standard-new-complete')
assert(existsSync(newCompleteVariant), 'v0.1.3+ opt-out variant generated')
const newCompleteYaml = readFileSync(join(newCompleteVariant, 'agent.cordis.yml'), 'utf8')
assert(!newCompleteYaml.includes('inside a WSL'), 'a v0.1.3+ persona with complete: true is left alone')
assert(newCompleteYaml.includes('suffix: Your working directory is {{cwd}}.'), 'its suffix stays a plain inline scalar')
const minVariant = join(home, '.agent-presets', 'wsl-minimal')
const minYaml = readFileSync(join(minVariant, 'agent.cordis.yml'), 'utf8')
assert(existsSync(minVariant), 'wsl-minimal variant generated')
assert(!minYaml.includes('fs-local'), 'minimal variant drops fs-local')
assert(minYaml.includes('str-replace-editor'), 'minimal variant re-injects the editor over the WSL fs')
assert(!minYaml.includes('persistent-shell'), 'minimal variant drops the PTY group (duplicate bash registration + unsupported win32 PTY)')
assert(!minYaml.includes('persistent-bash'), 'minimal variant drops persistent-bash')
assert(
  /- id: skill-filesystem\n  name: '[^']+'\n  config:\n    watch: false\n/.test(minYaml),
  'a skill-filesystem row with no config gets one carrying watch: false',
)

const prefabVariant = join(home, '.agent-presets', 'wsl-third-party-local')
const prefabYaml = readFileSync(join(prefabVariant, 'agent.cordis.yml'), 'utf8')
assert(existsSync(prefabVariant), 'third-party WSL variant generated')
assert(!prefabYaml.includes('custom-bash'), 'third-party variant drops custom-bash (would double-register bash)')
assert(!prefabYaml.includes('bootstrap-filesystem'), 'third-party variant drops bootstrap-filesystem (host-local fs)')
assert(prefabYaml.includes('- id: wsl-world'), 'third-party variant injects wsl realm')
assert((prefabYaml.match(/name: '@deepseek-ai\/dsh-tool-bash'/g) ?? []).length === 1, 'third-party variant registers bash exactly once')
assert(prefabYaml.includes('str-replace-editor'), 'third-party variant re-injects the editor over the WSL fs')
assert(existsSync(join(prefabVariant, 'plugin-data', 'trajectory.bin')), 'third-party opaque asset directory is mirrored')

// Stale variant cleanup: a wsl-ghost dir whose source vanished must go.
mkdirSync(join(home, '.agent-presets', 'wsl-ghost'), { recursive: true })
writeFileSync(join(home, '.agent-presets', 'wsl-ghost', 'agent.cordis.yml'), '- id: x\n', 'utf8')
// Rerun apply to exercise cleanup.
rmSync(join(home, 'src-third-party', 'plugin-data', 'trajectory.bin'))
apply(fakeCtx, { route: '/wsl-workspace/api' })
await new Promise(resolve => setTimeout(resolve, 300))
assert(!existsSync(join(home, '.agent-presets', 'wsl-ghost')), 'stale variant cleaned up')
assert(existsSync(join(home, '.agent-presets', 'wsl-standard')), 'kept variant survives rerun')
assert(!existsSync(join(prefabVariant, 'plugin-data', 'trajectory.bin')), 'removed source asset does not survive regeneration')

// A failed source mirror must leave the previous complete variant untouched.
sources['third-party-local'].text = `${PREFAB_SRC}\n# incomplete-update-must-not-publish\n`
sources['third-party-local'].path = join(home, 'missing-source', 'agent.cordis.yml')
apply(fakeCtx, { route: '/wsl-workspace/api' })
await new Promise(resolve => setTimeout(resolve, 300))
assert(!readFileSync(join(prefabVariant, 'agent.cordis.yml'), 'utf8').includes('incomplete-update-must-not-publish'), 'failed regeneration preserves the previous complete variant')

rmSync(home, { recursive: true, force: true })
console.log('HOST MATERIALIZE PASSED')
