/**
 * Unit tests for the WSL preset-variant transformation. Run with
 * `node --import tsx/esm --test tests/variants.test.ts` from the plugin
 * directory.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWslVariantId, transformPresetForWsl, variantIdFor } from '../src/host/variants.ts'

const SHELL = 'D:/plugin/lib/shell.js'
const FS = 'D:/plugin/lib/fs.js'

/** A standard-like composition (the shape standard/code/cordis share). */
const STANDARD_LIKE = `# identity
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a coding agent powered by the {{model}} model. Your working
      directory is {{cwd}}.

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'
`

/** The minimal composition's distinctive rows (persistent shell + editor). */
const MINIMAL_LIKE = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: You are a helpful software engineer assistant.
    complete: true
    includeRuntimeContext: false

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
      config:
        cwd: !!js process.env.DSH_CWD ?? process.cwd()

    - id: str-replace-editor
      name: '@deepseek-ai/dsh-tool-str-replace-editor'
      config:
        maxOutputChars: 16000
`

test('variantIdFor lowercases source ids', () => {
  assert.equal(variantIdFor('standard'), 'wsl-standard')
  assert.equal(variantIdFor('Code'), 'wsl-code')
})

test('isWslVariantId recognizes plugin-owned preset ids only', () => {
  assert.equal(isWslVariantId('wsl'), true)
  assert.equal(isWslVariantId('wsl-standard'), true)
  assert.equal(isWslVariantId('standard'), false)
  assert.equal(isWslVariantId('wsl-standard-extra'), true)
})

test('standard-like transform drops world rows and injects the WSL realm', () => {
  const out = transformPresetForWsl(STANDARD_LIKE, SHELL, FS)
  // Top-level rows sit at column 0; the injected group's rows are indented.
  assert.ok(!/^- id: tool-pwsh$/m.test(out), 'pwsh row dropped')
  assert.ok(!/^- id: tool-bash$/m.test(out), 'top-level bash row dropped')
  assert.ok(!/^- id: tool-fs$/m.test(out), 'top-level fs row dropped')
  assert.ok(!/^- id: tool-fs-search$/m.test(out), 'grep tool dropped (Windows rg cannot open Linux paths)')
  assert.ok(out.includes('- id: tool-jobs'), 'jobs row kept')
  assert.ok(out.includes('- id: wsl-world'), 'wsl realm injected')
  assert.ok(out.includes(`name: '${SHELL}'`), 'shell provider path present')
  assert.ok(out.includes(`name: '${FS}'`), 'fs provider path present')
  assert.ok(out.includes('isolate:\n    shell: true\n    fs: true'), 'realm isolates shell+fs')
  assert.ok(out.includes('Your working directory {{cwd}} is inside a WSL'), 'persona amended')
  assert.ok(!out.includes('persistent-shell'), 'no persistent shell for standard-like')
})

test('minimal-like transform keeps persona fixed and uses the cwd-aware fs tools', () => {
  const out = transformPresetForWsl(MINIMAL_LIKE, SHELL, FS)
  assert.ok(!out.includes('fs-local'), 'fs-local dropped')
  assert.ok(out.includes('str-replace-editor'), 'editor re-injected over the session-aware WSL fs')
  assert.ok(!out.includes('persistent-shell'), 'persistent shell dropped (duplicate bash name + unsupported win32 PTY)')
  assert.ok(!out.includes('persistent-bash'), 'persistent-bash dropped')
  assert.ok(!out.includes('complete: true') || out.includes('complete: true'), 'persona untouched')
  assert.ok(!out.includes('inside a WSL'), 'minimal persona not amended (complete prompt)')
})

/** A prefab-family composition: win32-only custom bash + local fs group. */
const PREFAB_LIKE = `- id: persona
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

test('third-party transform drops the extra host execution-world rows', () => {
  const out = transformPresetForWsl(PREFAB_LIKE, SHELL, FS)
  assert.ok(!out.includes('custom-bash'), 'custom-bash dropped (would double-register bash)')
  assert.ok(!out.includes('bootstrap-filesystem'), 'bootstrap-filesystem dropped (host-local fs)')
  assert.ok(!/name: '\.\/custom-bash\.mjs'/.test(out), 'custom-bash row file not referenced')
  assert.ok(out.includes('- id: wsl-world'), 'wsl realm injected')
  assert.ok(out.includes('str-replace-editor'), 'editor re-injected over the WSL fs')
  const bashRegistrants = out.match(/name: '@deepseek-ai\/dsh-tool-bash'/g)?.length ?? 0
  assert.equal(bashRegistrants, 1, 'exactly one bash tool registration')
})

test('a top-level editor is replaced instead of registered twice', () => {
  const out = transformPresetForWsl(`- id: str-replace-editor
  name: '@deepseek-ai/dsh-tool-str-replace-editor'
`, SHELL, FS)
  const editorRegistrants = out.match(/name: '@deepseek-ai\/dsh-tool-str-replace-editor'/g)?.length ?? 0
  assert.equal(editorRegistrants, 1)
})

test('transform preserves unknown rows verbatim', () => {
  const out = transformPresetForWsl(`${STANDARD_LIKE}\n- id: my-custom-tool\n  name: '@me/dsh-custom'\n`, SHELL, FS)
  assert.ok(out.includes("- id: my-custom-tool\n  name: '@me/dsh-custom'"), 'unknown row kept')
})

test('transform handles an empty source', () => {
  const out = transformPresetForWsl('', SHELL, FS)
  assert.ok(out.includes('- id: wsl-world'), 'realm still injected')
})
