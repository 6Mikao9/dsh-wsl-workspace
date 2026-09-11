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
const WORLD_ROWS = new Set(['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'str-replace-editor', 'filesystem', 'persistent-shell', 'custom-bash', 'bootstrap-filesystem'])

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
    // The editor resolves through this entry-local WSL fs. Older editor builds
    // pass no cwd, so the provider inherits it from the current tool execution.
    // Anchored-family presets require this name during bootstrap.
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

/** The sentence appended to a standard-like persona when the variant runs in WSL. */
const PERSONA_APPEND = ' Your working directory {{cwd}} is inside a WSL (Windows Subsystem for Linux) distribution: the bash tool and the file read/write/edit tools use Linux paths, and the Windows filesystem is reachable as /mnt/<drive> for file migration.'

/** The upstream local-skill provider row, whose watcher cannot watch a UNC share. */
const SKILL_FILESYSTEM_ROW = 'skill-filesystem'

/**
 * Turn the local skill provider's watcher off inside a WSL variant.
 *
 * `@deepseek-ai/dsh-skill-filesystem` reports an INCOMPLETE observation when
 * its watcher fails to start, and `dsh-tool-skill` withholds the whole catalog
 * while a snapshot is incomplete. chokidar cannot watch
 * `\\wsl.localhost\<distro>\...`, so in a WSL session the model never sees the
 * catalog at all - `skill` still loads one by name, but nothing tells the model
 * which skills exist. With the watcher off the discovery completes (the
 * plugin's own provider rescans the share on demand, and the next session gets
 * a fresh catalog); the price is no live refresh inside one running session,
 * which never worked on this substrate anyway.
 * @param block - the row's lines.
 * @returns the row's lines with `watch: false` merged into its config.
 */
function disableSkillWatch(block: readonly string[]): string[] {
  const lines = [...block]
  // An explicit `watch:` from the author wins.
  if (lines.some(line => /^\s*watch:/.test(line))) return lines
  const configIndex = lines.findIndex(line => /^\s*config:\s*$/.test(line))
  if (configIndex >= 0) {
    const childIndent = `${/^(\s*)/.exec(lines[configIndex] ?? '')?.[1] ?? '  '}  `
    lines.splice(configIndex + 1, 0, `${childIndent}watch: false`)
    return lines
  }
  const rowIndent = /^(\s*)/.exec(lines[0] ?? '')?.[1] ?? ''
  // Insert before the row block's trailing blank line, not after it.
  let insertAt = lines.length
  while (insertAt > 0 && (lines[insertAt - 1] ?? '').trim() === '') insertAt -= 1
  lines.splice(insertAt, 0, `${rowIndent}  config:`, `${rowIndent}    watch: false`)
  return lines
}

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

/** Persona config scalars that carry model-facing text, in append preference order. */
const PERSONA_TARGET_FIELDS = ['suffix', 'text', 'prefix'] as const

/** One persona config scalar: where it sits, and whether it is a block header. */
interface PersonaTarget {
  /** Line index of the scalar inside the persona block. */
  index: number
  /** Field name: `suffix`, `text` or `prefix`. */
  field: string
  /** Indentation of the scalar's own line. */
  indent: number
  /** Block header (`>-`, `|-`, …) when the scalar is folded/literal, else ''. */
  header: string
  /** Unquoted inline value when the scalar is inline, else ''. */
  inline: string
}

/** Strip one layer of YAML quoting so a value can move into a block scalar. */
function unquoteScalar(value: string): string {
  const single = /^'(.*)'$/s.exec(value)
  if (single !== null) return (single[1] ?? '').replace(/''/g, "'")
  const double = /^"(.*)"$/s.exec(value)
  return double !== null ? (double[1] ?? '') : value
}

/**
 * Locate the persona scalar this transform amends.
 *
 * DSH moved the model-facing prompt text across releases: `text` up to
 * v0.1.2-rc.1, and `prefix` + `suffix` from v0.1.3-alpha.2 on. `suffix` wins
 * when both exist because it carries the working-directory sentence, so the
 * appended note lands exactly where the legacy `text` block put it; `prefix`
 * is the last resort for a composition that has neither. A known field with an
 * empty value is not amendable.
 * @param block - the persona row's lines.
 * @returns the target scalar, or undefined when the row carries none.
 */
function personaTarget(block: readonly string[]): PersonaTarget | undefined {
  for (const field of PERSONA_TARGET_FIELDS) {
    for (let index = 0; index < block.length; index += 1) {
      const match = new RegExp(`^(\\s*)${field}:\\s*(.*)$`).exec(block[index] ?? '')
      if (match === null) continue
      const indent = match[1]?.length ?? 0
      const rest = (match[2] ?? '').trim()
      if (rest === '' || /^[|>][+-]?$/.test(rest)) {
        return { index, field, indent, header: rest, inline: '' }
      }
      return { index, field, indent, header: '', inline: unquoteScalar(rest) }
    }
  }
  return undefined
}

/**
 * Index of the last line belonging to the block scalar whose header is at
 * `headerIndex`. A non-blank line at or above the header's indentation is the
 * next sibling key and ends the scalar — without that stop a persona carrying
 * both `suffix` and `prefix` blocks would take the note in the wrong one.
 * @param block - the persona row's lines.
 * @param headerIndex - index of the `field: >-` header line.
 * @param indent - the header's own indentation.
 * @returns the last content line's index, or -1 when the scalar is empty.
 */
function lastBlockLine(block: readonly string[], headerIndex: number, indent: number): number {
  let last = -1
  for (let index = headerIndex + 1; index < block.length; index += 1) {
    const line = block[index] ?? ''
    if (line.trim() === '') continue
    const lineIndent = /^(\s*)/.exec(line)?.[1]?.length ?? 0
    if (lineIndent <= indent) break
    last = index
  }
  return last
}

/** Whether a top-level span is a `persona` row this transform may amend. */
function appendablePersona(lines: readonly string[], span: { start: number; end: number }): boolean {
  const block = lines.slice(span.start, span.end)
  // `complete: true` asks the persona plugin for no runtime context at all.
  if (block.join('\n').includes('complete: true')) return false
  const target = personaTarget(block)
  if (target === undefined) return false
  return target.header === ''
    ? target.inline !== ''
    : lastBlockLine(block, target.index, target.indent) >= 0
}

/**
 * Append the WSL sentence to a persona row's model-facing scalar, in place.
 *
 * A block scalar takes the sentence as a sibling line, which is what the
 * legacy `text: >-` form always did. An inline scalar cannot: it is folded into
 * a block scalar first, so the sentence joins it the same way (and the model
 * sees the same text it saw before v0.1.3-alpha.2).
 * @param lines - the whole composition's lines.
 * @param span - the persona row's span.
 * @returns the persona row's lines, amended when a target was found.
 */
function appendPersona(lines: readonly string[], span: { start: number; end: number }): string[] {
  const block = [...lines.slice(span.start, span.end)]
  const target = personaTarget(block)
  if (target === undefined) return block
  const pad = ' '.repeat(target.indent)
  if (target.header !== '') {
    const last = lastBlockLine(block, target.index, target.indent)
    if (last < 0) return block
    const textIndent = /^(\s*)/.exec(block[last] ?? '')?.[1] ?? `${pad}  `
    block.splice(last + 1, 0, `${textIndent}${PERSONA_APPEND}`)
    return block
  }
  const child = `${pad}  `
  block.splice(
    target.index,
    1,
    `${pad}${target.field}: >-`,
    `${child}${target.inline}`,
    `${child}${PERSONA_APPEND.trim()}`,
  )
  return block
}

/**
 * Transform one source preset composition into its WSL variant: drop the
 * execution-world rows, keep everything else verbatim, and append the WSL
 * world group. The persistent-shell group is NOT re-added: it registers the
 * same `bash` tool name as the WSL world's `dsh-tool-bash`, and the tools
 * registry rejects duplicates within one preset layer — the whole variant
 * fails to mount and the session falls back to another preset. Its PTY
 * backend additionally cannot run on this plugin's Windows host
 * (`dsh-subprocess-local`: "terminal inspection is unsupported on platform
 * win32"), so the group could never spawn a shell here anyway. The WSL
 * world's ordinary `bash` tool covers command execution for every variant.
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
  let personaAppended = false
  for (const span of spans) {
    const id = spanId(lines, span)
    if (id === undefined) {
      kept.push(...lines.slice(span.start, span.end))
      continue
    }
    if (WORLD_ROWS.has(id)) continue
    if (id === SKILL_FILESYSTEM_ROW) {
      kept.push(...disableSkillWatch(lines.slice(span.start, span.end)))
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
