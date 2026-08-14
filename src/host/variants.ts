/**
 * WSL preset-variant generator. For every healthy source preset the roster
 * supplies, a `wsl-<id>` variant is materialized under the roster's user
 * root: the source composition with its shell/filesystem world replaced by
 * the WSL providers, so any mode (standard, minimal, code, cordis, user
 * presets) can run on top of a WSL execution world. The execution world is
 * therefore orthogonal to the mode instead of a mode itself.
 *
 * The transformation is text-level on the top-level rows of the composition
 * (the shape all shipped presets share), with surgical edits for the known
 * special groups; unknown shapes are kept verbatim where possible.
 * @module dsh-wsl-workspace/host/variants
 */

/** Top-level rows that name the execution world and are replaced by the variant's own. */
const WORLD_ROWS = new Set(['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'filesystem', 'persistent-shell'])

/** The injected WSL world group: providers + the bash/fs consumers, entry-local. */
function wslWorldGroup(shellPath: string, fsPath: string, includeEditor: boolean): string {
  return [
    '# ── WSL execution world (dsh-wsl-workspace variant) ─────────────────────',
    '# The shell and fs services are provided entry-locally (the isolate',
    '# realm); host services (tools registry, shell-env, jobs) fall through.',
    '# tool-fs-search is intentionally absent: the packaged ripgrep runs on',
    '# the Windows host and cannot open Linux paths; WSL sessions search with',
    '# shell tools instead.',
    '- id: wsl-world',
    "  name: cordis:group",
    '  group: true',
    '  isolate:',
    '    shell: true',
    '    fs: true',
    '  config:',
    `    - id: shell-wsl`,
    `      name: '${shellPath.replace(/'/g, "''")}'`,
    '    - id: fs-wsl',
    `      name: '${fsPath.replace(/'/g, "''")}'`,
    '    - id: tool-bash',
    "      name: '@deepseek-ai/dsh-tool-bash'",
    '    - id: tool-fs',
    "      name: '@deepseek-ai/dsh-tool-fs'",
    ...(includeEditor
      ? [
          '    - id: str-replace-editor',
          "      name: '@deepseek-ai/dsh-tool-str-replace-editor'",
          '      config:',
          '        maxOutputChars: 16000',
        ]
      : []),
    '',
  ].join('\n')
}

/**
 * The persistent-shell group re-pointed at WSL: the PTY spawns wsl.exe's
 * bash instead of a host `bash` (which does not exist on Windows).
 */
function persistentShellGroup(): string {
  return [
    '# ── persistent shell over WSL (variant) ─────────────────────────────────',
    '- id: persistent-shell',
    '  name: cordis:group',
    '  group: true',
    '  isolate:',
    '    terminals: true',
    '  config:',
    '    - id: pty',
    "      name: '@deepseek-ai/dsh-terminal'",
    '',
    '    - id: terminal-bash',
    "      name: '@deepseek-ai/dsh-terminal-bash'",
    '      config:',
    '        timeoutMs: 300000',
    "        shellPath: 'wsl.exe'",
    "        shellArgs: ['-e', 'bash', '-l']",
    '',
    '    - id: persistent-bash',
    "      name: '@deepseek-ai/dsh-tool-bash-persistent'",
    '      config:',
    '        timeoutMs: 300000',
    '        description: |-',
    '          Run commands in a bash shell inside the WSL distribution',
    '          * When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.',
    "          * You don't have access to the internet via this tool.",
    '          * You do have access to a mirror of common linux and python packages via apt and pip.',
    '          * State is persistent across command calls and discussions with the user.',
    "          * To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.",
    '          * Please avoid commands that may produce a very large amount of output.',
    "          * Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.",
    '',
  ].join('\n')
}

/** The sentence appended to a standard-like persona when the variant runs in WSL. */
const PERSONA_APPEND = ' Your working directory {{cwd}} is inside a WSL (Windows Subsystem for Linux) distribution: the bash tool and the file read/write/edit tools use Linux paths, and the Windows filesystem is reachable as /mnt/<drive> for file migration.'

/** The top-level rows of one composition, as (startLine, endLineExclusive) spans. */
function topLevelSpans(lines: readonly string[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  let start = -1
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]?.startsWith('- id: ') === true) {
      if (start >= 0) spans.push({ start, end: index })
      start = index
    }
  }
  if (start >= 0) spans.push({ start, end: lines.length })
  return spans
}

/** The row id of a top-level span, or undefined when the first line is malformed. */
function spanId(lines: readonly string[], span: { start: number; end: number }): string | undefined {
  return /^- id: ([A-Za-z0-9_.-]+)/.exec(lines[span.start] ?? '')?.[1]
}

/** Whether a top-level span is a `persona` row with an appendable folded text. */
function appendablePersona(lines: readonly string[], span: { start: number; end: number }): boolean {
  const block = lines.slice(span.start, span.end).join('\n')
  if (!block.includes('complete: true') && /text: [>|-]/.test(block)) {
    // Append only when the folded text actually has content lines.
    const textLine = block.split('\n').find(line => /^(\s*)text: [>|-]/.test(line))
    if (textLine !== undefined) {
      const indent = /^(\s*)/.exec(textLine)?.[1]?.length ?? 0
      return block.split('\n').some(line => line.length > indent && /^\s+/.test(line) && !line.includes(':'))
    }
  }
  return false
}

/** Append the WSL sentence to a persona row's folded text (in place of its last text line). */
function appendPersona(lines: readonly string[], span: { start: number; end: number }): string[] {
  const block = lines.slice(span.start, span.end)
  const textIndex = block.findIndex(line => /^(\s*)text: [>|-]/.test(line))
  if (textIndex < 0) return [...block]
  const indent = /^(\s*)/.exec(block[textIndex] ?? '')?.[1]?.length ?? 0
  let lastText = -1
  for (let index = textIndex + 1; index < block.length; index++) {
    const line = block[index] ?? ''
    if (line.trim() === '') continue
    if (line.length > indent && /^\s+/.test(line)) lastText = index
  }
  if (lastText < 0) return [...block]
  const updated = [...block]
  const textIndent = /^(\s*)/.exec(block[lastText] ?? '')?.[1] ?? '  '
  updated.splice(lastText + 1, 0, `${textIndent}${PERSONA_APPEND}`)
  return updated
}

/**
 * Transform one source preset composition into its WSL variant: drop the
 * execution-world rows, keep everything else verbatim, and append the WSL
 * world group (plus the persistent-shell group when the source had one).
 * @param source - the source composition text.
 * @param shellPath - absolute path of the plugin's built WSL shell provider.
 * @param fsPath - absolute path of the plugin's built WSL fs provider.
 * @returns the variant composition text.
 */
export function transformPresetForWsl(source: string, shellPath: string, fsPath: string): string {
  const lines = source.split('\n')
  const spans = topLevelSpans(lines)
  const kept: string[] = []
  let sawEditor = false
  let sawPersistent = false
  let personaAppended = false
  for (const span of spans) {
    const id = spanId(lines, span)
    if (id === undefined) {
      kept.push(...lines.slice(span.start, span.end))
      continue
    }
    if (WORLD_ROWS.has(id)) {
      if (id === 'persistent-shell') sawPersistent = true
      continue
    }
    if (id === 'persona' && !personaAppended && appendablePersona(lines, span)) {
      kept.push(...appendPersona(lines, span))
      personaAppended = true
      continue
    }
    kept.push(...lines.slice(span.start, span.end))
    if (id === 'str-replace-editor') sawEditor = true
  }
  if (source.includes('str-replace-editor')) sawEditor = true
  const result = [...kept]
  if (result.length > 0 && result[result.length - 1] !== '') result.push('')
  result.push(wslWorldGroup(shellPath, fsPath, sawEditor))
  if (sawPersistent) result.push(persistentShellGroup())
  return result.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n')
}

/** Whether an id is one of this plugin's own preset directories. */
export function isWslVariantId(id: string): boolean {
  return id === 'wsl' || /^wsl-[a-z0-9-]+$/.test(id)
}

/** The variant id for one source preset id. */
export function variantIdFor(sourceId: string): string {
  return `wsl-${sourceId.toLowerCase()}`
}
