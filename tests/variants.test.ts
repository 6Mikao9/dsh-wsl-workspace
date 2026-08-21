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

test('minimal-like transform keeps persona fixed and re-points the PTY at wsl.exe', () => {
  const out = transformPresetForWsl(MINIMAL_LIKE, SHELL, FS)
  assert.ok(!out.includes('fs-local'), 'fs-local dropped')
  assert.ok(out.includes('str-replace-editor'), 'editor re-injected into the WSL realm')
  assert.ok(out.includes('persistent-shell'), 'persistent shell kept')
  assert.ok(out.includes("shellPath: 'wsl.exe'"), 'terminal re-pointed at wsl.exe')
  assert.ok(out.includes("shellArgs: ['-e', 'bash', '-l']"), 'wsl argv present')
  assert.ok(!out.includes('complete: true') || out.includes('complete: true'), 'persona untouched')
  assert.ok(!out.includes('inside a WSL'), 'minimal persona not amended (complete prompt)')
  // Minimal must not grow a standard-like tool catalog (issue #5): no one-shot
  // bash / fs tools alongside persistent-bash + str_replace_editor.
  assert.ok(!/^\s*- id: tool-bash$/m.test(out), 'minimal omits tool-bash')
  assert.ok(!/^\s*- id: tool-fs$/m.test(out), 'minimal omits tool-fs')
  assert.ok(!out.includes('shell-wsl'), 'minimal omits unused shell-wsl provider')
  assert.ok(out.includes('fs-wsl'), 'minimal keeps fs-wsl for the editor')
  assert.ok(out.includes('isolate:\n    fs: true'), 'minimal realm isolates fs only')
  assert.ok(!/isolate:\n    shell: true\n    fs: true[\s\S]*- id: tool-bash/.test(out), 'minimal does not mount shell tools realm')
})

test('transform preserves unknown rows verbatim', () => {
  const out = transformPresetForWsl(`${STANDARD_LIKE}\n- id: my-custom-tool\n  name: '@me/dsh-custom'\n`, SHELL, FS)
  assert.ok(out.includes("- id: my-custom-tool\n  name: '@me/dsh-custom'"), 'unknown row kept')
})

test('transform handles an empty source', () => {
  const out = transformPresetForWsl('', SHELL, FS)
  assert.ok(out.includes('- id: wsl-world'), 'realm still injected')
})
