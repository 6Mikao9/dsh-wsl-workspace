/**
 * WSL workspace skill provider (host half).
 *
 * DSH's shipped skill-filesystem provider scans only the session cwd's
 * project root (the nearest `.git` ancestor) for `.dsh/skills` / `.agents/skills`
 * and never descends into nested projects. A WSL workspace whose project
 * folders live below the registered workspace root therefore shows an empty
 * skill catalog, even though the same layout works when the session cwd is
 * the project folder itself (issue #10).
 *
 * This provider mirrors the host's discovery rules for WSL UNC session
 * workspaces: it starts at the session cwd's nearest `.git` ancestor (the
 * host's project-root rule; the cwd itself when no ancestor has a `.git`
 * marker), then walks that root (depth- and budget-bounded). Directory
 * symlinks are followed when the substrate resolves them and pruned safely
 * when it does not — the `\\wsl.localhost` 9P share cannot resolve Linux
 * symlink targets, so linked-in projects stay undiscoverable there today.
 * The walk collects every
 * `.dsh/skills` and `.agents/skills` directory it finds — including nested
 * projects — and publishes their skills with the same
 * project ranks and sources the host uses, so precedence and duplicate
 * resolution behave identically. Non-WSL lookups return nothing and leave
 * the host's own providers untouched.
 *
 * All filesystem reads go through `node:fs` against the `\\wsl.localhost\…`
 * 9P share (the same substrate `WslFileSystem` uses); an injectable IO face
 * keeps the discovery logic unit-testable without a live distro.
 *
 * @module dsh-wsl-workspace/host/wsl-skills
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join as joinWindowsPath, posix } from 'node:path'
import { joinUnc, parseWslUnc } from '../shared/paths.ts'

/** Project ranks copied from @deepseek-ai/dsh-skill-filesystem so WSL and host entries interleave identically. */
const PROJECT_DSH_RANK = 100
const PROJECT_AGENTS_RANK = 200

/** How many directory levels below the workspace root are scanned. */
const MAX_SCAN_DEPTH = 4
/** Maximum distinct skill directories published per lookup. */
const MAX_SKILL_ROOTS = 64
/** Maximum directories visited per lookup (an absolute blast-radius cap). */
const MAX_VISITED_DIRECTORIES = 4096
/** How many parent levels above the session cwd are searched for a `.git` project marker. */
const MAX_ANCESTOR_WALK = 64
/** How long a completed lookup is served from cache before the next rescan. */
const CACHE_TTL_MS = 10_000
/** Maximum cached lookups (one entry per distinct scan root across sessions). */
const CACHE_MAX_ENTRIES = 32
/** Kebab-case skill names, matching the host grammar. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Directory names that never contain project skill roots (safe to prune while walking). */
const PRUNED_DIRECTORY_NAMES = new Set([
  '.git', '.hg', '.svn', '.bzr', 'node_modules', '.venv', 'venv', '.tox',
  '.pants.d', '.next', '.nuxt', 'dist', 'build', 'out', 'coverage',
  '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.cache',
  '.idea', '.vscode', '.serverless', '.terraform', '.yarn', '.pnpm-store',
])

/** One `name: value` frontmatter line pair the parser understands. */
interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  content: string
}

/** The provider's minimal skill-candidate contract (mirrors @deepseek-ai/dsh-skill). */
export interface WslSkillCandidate {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: { modelInvocable: boolean; userInvocable: boolean }
  readonly source: string
  readonly provider: string
  readonly rank: number
  readonly locator: { path: string; directory: string }
  readonly path: string
}

/** The provider's minimal skill-definition contract (candidate plus body). */
export interface WslSkillDefinition extends WslSkillCandidate {
  readonly content: string
}

/** Lookup options the registry passes to `list`/`get`. */
export interface WslSkillLookupOptions {
  readonly cwd?: string
  readonly signal?: AbortSignal
}

/** Registration-scoped lifecycle face passed to the provider constructor. */
export interface WslSkillProviderControl {
  readonly signal: AbortSignal
  readonly invalidate: () => void
}

/** The `ctx.skills` registry face this provider registers on (optional service). */
export interface WslSkillsRegistryFace {
  registerProvider(create: (control: WslSkillProviderControl) => {
    readonly name: string
    list(options: WslSkillLookupOptions): Promise<unknown>
    get(candidate: WslSkillCandidate, options: WslSkillLookupOptions): Promise<unknown>
  }): () => void
}

/** Injectable filesystem face (defaults to node:fs/promises on the real 9P share). */
export interface WslSkillIo {
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>
  readFile(path: string, options: { encoding: 'utf8' }): Promise<string>
  stat(path: string): Promise<{ isDirectory(): boolean }>
}

/** The node:fs/promises implementation the provider uses in production. */
export const nodeSkillIo: WslSkillIo = {
  readdir: async (path, options) => readdir(path, options),
  readFile: async (path, options) => readFile(path, options),
  stat: async path => stat(path),
}

/** One discovered skill directory under a WSL workspace. */
interface SkillRoot {
  /** Absolute UNC path of the skills directory (`…\.dsh\skills`). */
  path: string
  /** Host source label ('project-dsh' | 'project-agents'). */
  source: 'project-dsh' | 'project-agents'
  /** Host project rank so same-name wins and precedence stay consistent. */
  rank: number
}

/** Whether a skills-directory entry is a directory-bundle or a flat markdown skill. */
interface SkillEntry {
  name: string
  kind: 'bundle' | 'flat'
  path: string
}

/**
 * Locate the nearest ancestor of `linuxDir` (the directory itself included)
 * containing a `.git` marker, mirroring the host skill-filesystem's
 * project-root rule. `.git` may be a directory or a worktree pointer file;
 * existence is enough. Bounded so a pathological path cannot spin the walk.
 * @param distro - the WSL distribution name.
 * @param linuxDir - the session cwd's absolute Linux path.
 * @param io - filesystem face.
 * @returns the project root's Linux path, or `undefined` when no ancestor carries a `.git`.
 */
async function nearestGitAncestor(distro: string, linuxDir: string, io: WslSkillIo): Promise<string | undefined> {
  let current = linuxDir
  for (let levels = 0; levels <= MAX_ANCESTOR_WALK; levels += 1) {
    try {
      await io.stat(joinUnc(distro, posix.join(current, '.git')))
      return current
    } catch {
      // No `.git` marker at this level; keep walking towards the filesystem root.
    }
    const parent = posix.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

/**
 * Scan a WSL workspace root for nested skill directories.
 * @param distro - the WSL distribution name.
 * @param linuxRoot - the workspace's absolute Linux path.
 * @param io - filesystem face.
 * @returns discovered skill directories, bounded by depth and budget.
 */
async function discoverSkillRoots(distro: string, linuxRoot: string, io: WslSkillIo): Promise<SkillRoot[]> {
  const roots: SkillRoot[] = []
  const visited = new Set<string>()
  // BFS layers so the budget prunes the widest, most redundant levels first
  // (shallow skill dirs matter most): [path, depth] pairs.
  let frontier: [string, number][] = [[linuxRoot, 0]]
  while (frontier.length > 0 && roots.length < MAX_SKILL_ROOTS) {
    const next: [string, number][] = []
    for (const [dir, depth] of frontier) {
      if (visited.size >= MAX_VISITED_DIRECTORIES) return roots
      if (visited.has(dir)) continue
      visited.add(dir)
      if (roots.length < MAX_SKILL_ROOTS) {
        const directoryRoots = await skillRootsOfDirectory(distro, dir, io)
        roots.push(...directoryRoots.slice(0, MAX_SKILL_ROOTS - roots.length))
      }
      if (depth >= MAX_SCAN_DEPTH) continue
      let entries: Dirent[]
      try {
        entries = await io.readdir(joinUnc(distro, dir), { withFileTypes: true })
      } catch {
        // An unreadable directory (permissions, vanished mid-walk) prunes its subtree.
        continue
      }
      for (const entry of entries) {
        if (PRUNED_DIRECTORY_NAMES.has(entry.name)) continue
        if (entry.name.startsWith('.') && entry.name !== '.dsh' && entry.name !== '.agents') continue
        if (entry.name === '.dsh' || entry.name === '.agents') continue
        const childPath = posix.join(dir, entry.name)
        if (entry.isDirectory()) {
          next.push([childPath, depth + 1])
          continue
        }
        if (entry.isSymbolicLink()) {
          // A project may be linked into the workspace via a directory
          // symlink; follow it when the target is a directory. Symlink
          // cycles stay bounded: every hop increments the depth (capped by
          // MAX_SCAN_DEPTH) and the walk as a whole by MAX_VISITED_DIRECTORIES.
          try {
            const target = await io.stat(joinUnc(distro, childPath))
            if (target.isDirectory()) next.push([childPath, depth + 1])
          } catch {
            // Dangling symlink: nothing to traverse.
          }
        }
      }
    }
    frontier = next
  }
  return roots
}

/**
 * Publish the skill roots of one scanned directory (its `.dsh/skills` and
 * `.agents/skills`, each with the host's project ranks).
 * @param distro - the WSL distribution name.
 * @param linuxDir - the scanned directory's Linux path.
 * @param io - filesystem face.
 * @returns the directory's skill roots that exist.
 */
async function skillRootsOfDirectory(distro: string, linuxDir: string, io: WslSkillIo): Promise<SkillRoot[]> {
  const result: SkillRoot[] = []
  for (const [marker, source, rank] of [
    ['.dsh', 'project-dsh', PROJECT_DSH_RANK],
    ['.agents', 'project-agents', PROJECT_AGENTS_RANK],
  ] as const) {
    const path = joinUnc(distro, posix.join(linuxDir, marker, 'skills'))
    try {
      const info = await io.stat(path)
      if (info.isDirectory()) result.push({ path, source, rank })
    } catch {
      // Absent skills directory: nothing to publish.
    }
  }
  return result
}

/** List one skills directory's entries (directory bundles and flat `.md` skills). */
async function listSkillEntries(root: SkillRoot, io: WslSkillIo): Promise<SkillEntry[]> {
  let dirents: Dirent[]
  try {
    dirents = await io.readdir(root.path, { withFileTypes: true })
  } catch {
    return []
  }
  const entries: SkillEntry[] = []
  for (const entry of dirents) {
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, kind: 'bundle', path: joinWindowsPath(root.path, entry.name, 'SKILL.md') })
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      entries.push({ name: entry.name.slice(0, -3), kind: 'flat', path: joinWindowsPath(root.path, entry.name) })
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

/** Read and parse one skill file; `undefined` when missing or unparsable. */
async function readSkill(path: string, io: WslSkillIo, signal?: AbortSignal): Promise<ParsedSkill | undefined> {
  signal?.throwIfAborted()
  let raw: string
  try {
    raw = await io.readFile(path, { encoding: 'utf8' })
  } catch {
    return undefined
  }
  signal?.throwIfAborted()
  return parseSkillFrontmatter(raw, path)
}

/**
 * Parse the frontmatter subset skill files use: `---` fenced YAML with
 * `name` / `description` / `whenToUse` / `user-invocable` /
 * `disable-model-invocation`. Single-line scalars and block scalars
 * (`|` literal, `>` folded) are understood; anything else is skipped,
 * matching the shipped provider's leniency: a bad file must not fail
 * the catalog.
 */
function parseSkillFrontmatter(raw: string, path: string): ParsedSkill | undefined {
  // Windows editors save UTF-8 with a BOM; a leading BOM must not make the
  // opening `---` line unmatchable and silently drop the skill.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findFrontmatterEnd(raw, start)
  if (closing === undefined) return undefined
  const lines = raw.slice(start, closing).split('\n')
  const fields = new Map<string, string>()
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').replace(/\r$/, '')
    const block = /^([A-Za-z0-9-]+):\s*([|>])[+-]?\s*$/.exec(line)
    if (block !== null) {
      const value = parseBlockScalar(lines, index, block[2] === '>')
      index = value.nextLineIndex
      if (value.text !== '') fields.set(block[1] ?? '', value.text)
      continue
    }
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line)
    if (match === null) continue
    const value = match[2]?.trim() ?? ''
    if (value !== '') fields.set(match[1] ?? '', unquote(value))
  }
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  if (!SKILL_NAME.test(name) || description === '') {
    return undefined
  }
  const whenToUse = fields.get('whenToUse')
  return {
    name,
    description,
    ...whenToUse !== undefined && whenToUse !== '' ? { whenToUse } : {},
    invocation: {
      modelInvocable: !frontmatterBoolean(fields, 'disable-model-invocation'),
      userInvocable: frontmatterBoolean(fields, 'user-invocable', true),
    },
    content: raw.slice(closing + 1).trim(),
  }
}

/**
 * Collect a YAML block scalar (`key: |` literal or `key: >` folded) starting
 * at `startIndex`'s following lines. The block runs until the first
 * non-indented, non-blank line; its common indentation is stripped.
 * @returns the scalar text and the index of the last consumed line.
 */
function parseBlockScalar(
  lines: string[],
  startIndex: number,
  folded: boolean,
): { text: string; nextLineIndex: number } {
  const collected: string[] = []
  let indent: string | undefined
  let index = startIndex
  while (index + 1 < lines.length) {
    index += 1
    const next = (lines[index] ?? '').replace(/\r$/, '')
    if (next.trim() === '') {
      collected.push('')
      continue
    }
    const indented = /^([ \t]+)(.*)$/.exec(next)
    if (indented === null) {
      index -= 1
      break
    }
    indent ??= indented[1]
    collected.push(indented[1]?.startsWith(indent) === true ? indented[2] : indented[1].replace(/^[ \t]+/, '') + indented[2])
  }
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()
  const text = (folded ? collected.filter(line => line !== '').join(' ') : collected.join('\n')).trim()
  return { text, nextLineIndex: index }
}

/** Locate the closing `---` line of a frontmatter block. */
function findFrontmatterEnd(raw: string, start: number): number | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') return lineEnd + 1
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/** Strip one level of matching quotes from a scalar value. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/** Boolean semantics for `user-invocable` / `disable-model-invocation` (matches the host parser). */
function frontmatterBoolean(fields: Map<string, string>, key: string, dflt = false): boolean {
  const value = fields.get(key)
  if (value === undefined) return dflt
  switch (value.toLowerCase()) {
    case 'true':
    case 'yes':
    case 'on':
    case '1':
      return true
    case 'false':
    case 'no':
    case 'off':
    case '0':
      return false
    default:
      return dflt
  }
}

/**
 * The WSL workspace skill provider. Registered on the host's `ctx.skills`
 * registry; serves only lookups whose cwd is a WSL UNC workspace path.
 *
 * Completed `list()` lookups are cached per scan root for CACHE_TTL_MS so
 * repeated catalog builds over the slow 9P share do not rescan the tree;
 * `get()` always re-reads the skill file so body edits are picked up
 * immediately. `control.invalidate` remains reserved for host-driven
 * invalidation; the provider self-invalidates through the TTL.
 */
export class WslSkillsProvider {
  readonly name = 'wsl-workspace'
  private readonly control: WslSkillProviderControl
  private readonly io: WslSkillIo
  private readonly now: () => number
  private readonly cache = new Map<string, { expiresAt: number; candidates: WslSkillCandidate[] }>()
  private readonly refreshing = new Set<string>()

  constructor(control: WslSkillProviderControl, io: WslSkillIo = nodeSkillIo, now: () => number = Date.now) {
    this.control = control
    this.io = io
    this.now = now
  }

  /**
   * Discover nested project skills for a WSL UNC session workspace.
   * @param options - lookup options; `cwd` selects the WSL workspace.
   * @returns candidates for every `.dsh/skills` / `.agents/skills` under the
   *   session's scan root — the nearest `.git` ancestor of the cwd, else the
   *   cwd itself — or an empty array for non-WSL lookups.
   */
  async list(options: WslSkillLookupOptions): Promise<WslSkillCandidate[]> {
    this.control.signal.throwIfAborted()
    options.signal?.throwIfAborted()
    const unc = options.cwd === undefined ? null : parseWslUnc(options.cwd)
    if (unc === null) return []
    // Host parity: the session's project root is the nearest `.git` ancestor
    // of the cwd, so lookups from inside a project subtree still see that
    // project's skills; nested projects below it join via the bounded BFS.
    // Without a `.git` ancestor the session cwd itself is the scan root (the
    // issue #10 workspace layout).
    const scanRoot = (await nearestGitAncestor(unc.distro, unc.linuxPath, this.io)) ?? unc.linuxPath
    const cacheKey = `${unc.distro}\u0000${scanRoot}`
    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) {
      if (cached.expiresAt > this.now()) {
        this.cache.delete(cacheKey)
        this.cache.set(cacheKey, cached)
        return [...cached.candidates]
      }
      // Expired: serve the stale copy immediately and refresh in the
      // background, so a slow scan (e.g. a distro-root workspace) never
      // blocks the caller. A failed refresh keeps the stale entry and is
      // retried on the next lookup.
      if (!this.refreshing.has(cacheKey)) {
        this.refreshing.add(cacheKey)
        void this.scan(cacheKey, unc.distro, scanRoot, options.signal)
          .catch(() => { /* keep the stale entry; retried on the next lookup */ })
          .finally(() => { this.refreshing.delete(cacheKey) })
      }
      return [...cached.candidates]
    }
    return this.scan(cacheKey, unc.distro, scanRoot, options.signal)
  }

  /**
   * Run one discovery pass for a scan root and publish it into the cache.
   * @returns the fresh candidates.
   */
  private async scan(cacheKey: string, distro: string, scanRoot: string, signal?: AbortSignal): Promise<WslSkillCandidate[]> {
    const roots = await discoverSkillRoots(distro, scanRoot, this.io)
    const candidates: WslSkillCandidate[] = []
    const seenSkills = new Set<string>()
    for (const root of roots) {
      const entries = await listSkillEntries(root, this.io)
      for (const entry of entries) {
        signal?.throwIfAborted()
        const parsed = await readSkill(entry.path, this.io, signal)
        if (parsed === undefined) continue
        // A project reachable through both its real path and a directory
        // symlink yields aliasing roots whose locators differ; publish each
        // distinct (name, description, body) once so the catalog shows no
        // duplicates.
        const fingerprint = `${parsed.name}\u0000${parsed.description}\u0000${parsed.content}`
        if (seenSkills.has(fingerprint)) continue
        seenSkills.add(fingerprint)
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
          invocation: parsed.invocation,
          source: root.source,
          provider: this.name,
          rank: root.rank,
          locator: {
            path: entry.path,
            directory: entry.kind === 'bundle'
              ? joinWindowsPath(entry.path, '..')
              : root.path,
          },
          path: entry.path,
        })
      }
    }
    this.cache.set(cacheKey, { expiresAt: this.now() + CACHE_TTL_MS, candidates })
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    return candidates
  }

  /**
   * Load a complete skill body for a previously listed candidate.
   * @param candidate - the candidate this provider returned.
   * @param options - lookup options whose signal cancels the read.
   * @returns the full skill, or `undefined` if the file disappeared.
   */
  async get(candidate: WslSkillCandidate, options: WslSkillLookupOptions): Promise<WslSkillDefinition | undefined> {
    this.control.signal.throwIfAborted()
    const parsed = await readSkill(candidate.locator.path, this.io, options.signal)
    if (parsed === undefined || parsed.name !== candidate.name) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      source: candidate.source,
      provider: candidate.provider,
      rank: candidate.rank,
      locator: candidate.locator,
      path: candidate.path,
      content: parsed.content,
    }
  }
}