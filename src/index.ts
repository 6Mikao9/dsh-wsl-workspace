/**
 * Host half of dsh-wsl-workspace. Three responsibilities:
 *
 * 1. Materialize a `wsl-<mode>` variant for every healthy roster preset
 *    under `<dshHome>/.agent-presets/` (the roster's auto-scanned user
 *    root), so the WSL execution world — `shell-wsl` + `fs-wsl` behind one
 *    entry-local realm, with `tool-bash`/`tool-fs` consumers — composes with
 *    ANY mode instead of being a mode itself; the legacy standalone `wsl`
 *    preset directory and stale variants are removed on boot. The preset
 *    rows name THIS package's built lib files by absolute path, which the
 *    preset mount resolves to `file:` URLs without relying on bare specifier
 *    resolution from the preset's home directory.
 *
 * 2. Serve the browser dialog's data route (`/wsl-workspace/api`):
 *    distribution discovery, one-level directory listing, path checks, and
 *    the per-workspace username store — all over the 9P UNC share.
 *    Loopback-only, matching the sensitivity of the privileged configuration
 *    surface.
 *
 * 3. Contribute the per-session `DSH_WSL_DISTRO` managed-env fact so the WSL
 *    shell executor can resolve a plain Linux `workdir` to the calling
 *    session's distribution.
 * @module dsh-wsl-workspace
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { joinUnc, normalizeLinuxPath, isAbsoluteLinuxPath, isValidWslUsername, parseWslUnc } from './shared/paths.ts'
import { canonicalWslUnc, getWorkspaceUsername, setWorkspaceUsername } from './shared/wsl-credentials.ts'
import { defaultDistro, listDistros } from './shared/wsl.ts'
import { isWslVariantId, transformPresetForWsl, variantIdFor } from './host/variants.ts'

/** The HTTP route this plugin serves (a relative, same-origin path). */
export const DEFAULT_ROUTE = '/wsl-workspace/api'

/**
 * Bilingual display labels for the shipped source modes, matching the app's
 * own built-in copy in each language — note the `code` preset is "PTC 模式"
 * in the Chinese copy but "Code mode" in English. The DSH picker localizes
 * only the four built-in ids itself; `wsl-*` variant ids render the
 * preset.yml text verbatim, so the plugin writes one bilingual string so
 * both locales can identify each variant. Custom presets keep their own
 * name.
 */
const MODE_DISPLAY_LABELS: Readonly<Record<string, { en: string; zh: string }>> = {
  standard: { en: 'Standard mode', zh: '标准模式' },
  code: { en: 'Code mode', zh: 'PTC 模式' },
  minimal: { en: 'Minimal mode', zh: '极简模式' },
  cordis: { en: 'Creator mode', zh: '创造模式' },
}

/**
 * Quote a value as a single-line YAML single-quoted scalar. Plain scalars
 * cannot contain `: ` (colon + space), which plain English sentences do —
 * written unquoted they make the whole preset.yml unparsable, dropping the
 * name, description and order together.
 */
function yamlScalar(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** The variant name for one shipped mode (bilingual) or a custom preset. */
function variantName(presetId: string, sourceName: string): string {
  const labels = MODE_DISPLAY_LABELS[presetId]
  return labels === undefined ? `WSL · ${sourceName}` : `WSL · ${labels.en}（${labels.zh}）`
}

/** The variant description for one shipped mode (bilingual) or a custom preset. */
function variantDescription(presetId: string): string {
  const labels = MODE_DISPLAY_LABELS[presetId]
  const display = labels === undefined ? presetId : `${labels.en}（${labels.zh}）`
  return `WSL execution world for ${display}: bash and file tools run inside the WSL distribution.`
}

/** Plugin config. */
export interface Config {
  /** The route under which the dialog data API is served. */
  route?: string
}

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** The `webServer.register` route contract this plugin consumes. */
interface WebServerRoute {
  kind: 'exact'
  path: string
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

/** The `ctx.shellEnv` registry face this plugin consumes (optional service). */
interface ShellEnvService {
  register(contributor: {
    name: string
    variables: Readonly<Record<string, { description: string }>>
    resolve(execution: {
      agent?: { session: { header: { cwd?: string } } }
    }): Readonly<Partial<Record<string, string>>>
  }): () => void
}

/** One directory entry the dialog lists. */
interface WslDirEntryWire {
  name: string
  kind: 'directory' | 'file' | 'other'
}

/** One directory level plus its breadcrumb ancestry. */
interface WslDirListingWire {
  path: string
  parent: string | null
  entries: WslDirEntryWire[]
}

/** The wire envelope every method answers with. */
type Envelope<T> = { ok: true; value: T } | { ok: false; error: string }

const MAX_BODY_BYTES = 1024 * 1024

/** Valid WSL distribution names: one path-safe segment (no separators, no dot-dirs). */
const DISTRO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/

/** The loopback hostnames the data route answers to (DNS-rebinding fence). */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** True when a socket address is loopback (any IPv4/IPv6 spelling). */
function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** The hostname part of a `Host` header value (port and IPv6 brackets stripped). */
function hostNameOf(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end >= 0 ? host.slice(1, end) : host
  }
  return host.split(':')[0] ?? ''
}

/** True when the request's `Host` header names a loopback host. */
function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK_HOSTNAMES.has(hostNameOf(host).toLowerCase())
}

/**
 * Validate a wire-supplied distribution name before it becomes a UNC segment:
 * an attacker-controlled segment containing separators or `..` would escape
 * the `\\wsl.localhost\` share structure into arbitrary UNC paths.
 * @param value - the raw wire value.
 * @returns the validated distro name.
 */
function requireDistro(value: unknown): string {
  if (typeof value !== 'string' || !DISTRO_PATTERN.test(value) || value === '.' || value === '..') {
    throw new Error('distro must be a valid WSL distribution name')
  }
  return value
}

/** Human text for an unknown rejection. */
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** Write one JSON envelope. */
function json(res: ServerResponse, status: number, body: Envelope<unknown>): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/** Collect and parse the request body, bounded. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** Normalize a Linux path for the wire (rejecting non-absolute input). */
function requireLinuxPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isAbsoluteLinuxPath(value)) {
    throw new Error(`${label} must be an absolute Linux path`)
  }
  return normalizeLinuxPath(value)
}

/** Validate a wire-supplied workspace path and return its canonical UNC form. */
function requireWslUnc(value: unknown): string {
  if (typeof value !== 'string') throw new Error('path must be a string')
  const canonical = canonicalWslUnc(value)
  if (canonical === null) throw new Error('path must be a WSL UNC workspace path')
  return canonical
}

/** Resolve one directory listing over the 9P share. */
function listWslDir(distro: string, linuxPath: string): WslDirListingWire {
  const unc = joinUnc(distro, linuxPath)
  const dirents = readdirSync(unc, { withFileTypes: true })
  const entries: WslDirEntryWire[] = dirents
    .slice(0, 1000)
    .map((dirent): WslDirEntryWire => {
      const kind: WslDirEntryWire['kind'] = dirent.isDirectory()
        ? 'directory'
        : dirent.isFile() ? 'file' : 'other'
      return { name: dirent.name, kind }
    })
    .sort((a, b) => {
      if (a.kind === 'directory' && b.kind !== 'directory') return -1
      if (a.kind !== 'directory' && b.kind === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
  const parent = linuxPath === '/' ? null : linuxPath.split('/').slice(0, -1).join('/') || '/'
  return { path: linuxPath, parent, entries }
}

/** Route one method dispatch. */
async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'listDistros': {
      const distros = await listDistros()
      const fallback = await defaultDistro()
      if (fallback !== undefined && distros.includes(fallback)) {
        return [fallback, ...distros.filter(name => name !== fallback)]
      }
      return distros
    }
    case 'listDir': {
      const distro = requireDistro(params.distro)
      const path = requireLinuxPath(params.path, 'path')
      return listWslDir(distro, path)
    }
    case 'check': {
      const distro = requireDistro(params.distro)
      const path = requireLinuxPath(params.path, 'path')
      const unc = joinUnc(distro, path)
      try {
        const info = statSync(unc)
        return { exists: true, isDirectory: info.isDirectory() }
      } catch {
        return { exists: false, isDirectory: false }
      }
    }
    case 'setUser': {
      const path = requireWslUnc(params.path)
      const username = params.username
      if (username === undefined || username === '') {
        setWorkspaceUsername(path, undefined)
      } else {
        if (typeof username !== 'string' || !isValidWslUsername(username)) {
          throw new Error('username must match the Linux username pattern [A-Za-z_][A-Za-z0-9_.-]*')
        }
        setWorkspaceUsername(path, username)
      }
      return null
    }
    default:
      throw new Error(`unknown method "${method}"`)
  }
}

/** The `ctx.agentPresets` roster face this plugin consumes (optional service). */
interface AgentPresetsService {
  list(): Promise<{ id: string; broken?: string; path: string }[]>
  read(id: string): Promise<string>
}

/**
 * Materialize a `wsl-<mode>` variant for every healthy source preset, and
 * remove this plugin's managed residue: stale variants whose source
 * disappeared, plus the legacy standalone `wsl` preset directory (the
 * execution world now composes with modes; a standalone WSL mode no longer
 * exists). Managed files: rewritten on every boot.
 * @param agentPresets - the roster service.
 * @param dshHome - the harness home (user preset root parent).
 * @param shellPath - absolute path of the plugin's built WSL shell provider.
 * @param fsPath - absolute path of the plugin's built WSL fs provider.
 */
async function materializeVariants(
  agentPresets: AgentPresetsService,
  dshHome: string,
  shellPath: string,
  fsPath: string,
): Promise<void> {
  const presets = await agentPresets.list()
  const userRoot = join(dshHome, '.agent-presets')
  const generated = new Set<string>()
  for (const preset of presets) {
    if (preset.broken !== undefined) continue
    if (isWslVariantId(preset.id)) continue
    const variantId = variantIdFor(preset.id)
    const source = await agentPresets.read(preset.id)
    const transformed = transformPresetForWsl(source, shellPath, fsPath)
    const dir = join(userRoot, variantId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'agent.cordis.yml'), transformed, 'utf8')
    const labels = MODE_DISPLAY_LABELS[preset.id]
    let name = variantName(preset.id, preset.id)
    let orderLine = ''
    try {
      const meta = readFileSync(join(dirname(preset.path), 'preset.yml'), 'utf8')
      if (labels === undefined) {
        // Custom presets keep their own display name; shipped modes use the
        // bilingual labels above so both locales can identify the variant.
        const match = /^name:\s*(.+)$/m.exec(meta)
        if (match?.[1] !== undefined && match[1].trim() !== '') {
          name = variantName(preset.id, match[1].trim())
        }
      }
      // Inherit the source's declared order so the WSL variants line up with
      // the local modes in the roster (standard, PTC, minimal, cordis).
      const orderMatch = /^order:\s*(\d+)\s*$/m.exec(meta)
      if (orderMatch?.[1] !== undefined) orderLine = `order: ${orderMatch[1]}\n`
    } catch {
      // Absent or unreadable display metadata falls back to the id-based name.
    }
    writeFileSync(
      join(dir, 'preset.yml'),
      `name: ${yamlScalar(name)}\n`
      + orderLine
      + `description: ${yamlScalar(variantDescription(preset.id))}\n`,
      'utf8',
    )
    generated.add(variantId)
  }
  for (const entry of readdirSync(userRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'wsl') {
      // The legacy standalone WSL mode: folded into the variants above.
      rmSync(join(userRoot, entry.name), { recursive: true, force: true })
      continue
    }
    if (!/^wsl-[a-z0-9-]+$/.test(entry.name)) continue
    if (!generated.has(entry.name)) rmSync(join(userRoot, entry.name), { recursive: true, force: true })
  }
}

/** Function-plugin plugin contract. */
export const name = 'dsh-wsl-workspace'

/** Required services. */
export const inject = ['webServer']

/** Validated plugin config (schemastery applied the defaults). */
export const Config: z<Config> = z.object({
  route: z.string().default(DEFAULT_ROUTE),
})

/**
 * Apply the host half: materialize the `wsl` preset plus a `wsl-<mode>`
 * variant for every healthy roster preset, register the data route, and
 * contribute the per-session `DSH_WSL_DISTRO` managed-env fact so the WSL
 * shell executor can resolve a plain Linux `workdir` to the calling
 * session's distribution.
 * @param ctx - the host plugin context.
 * @param config - the validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const packageRoot = fileURLToPath(new URL('..', import.meta.url))
  const shellPath = join(packageRoot, 'lib', 'shell.js').replace(/\\/g, '/')
  const fsPath = join(packageRoot, 'lib', 'fs.js').replace(/\\/g, '/')

  const agentPresets = ctx.get('agentPresets') as unknown as AgentPresetsService | undefined
  if (agentPresets !== undefined) {
    ctx.effect(() => {
      void materializeVariants(agentPresets, dshHome, shellPath, fsPath).catch((error) => {
        // Variant generation is best-effort over a live roster: a missing or
        // unreadable source preset must not take the whole plugin down, but
        // the failure is surfaced loudly rather than hidden.
        console.error(`dsh-wsl-workspace: WSL preset-variant generation failed: ${messageOf(error)}`)
      })
      return () => {}
    }, 'dsh-wsl-workspace: WSL preset variants')
  }

  const shellEnv = ctx.get('shellEnv') as unknown as ShellEnvService | undefined
  if (shellEnv !== undefined) {
    ctx.effect(() => shellEnv.register({
      name: 'wsl-workspace-distro',
      variables: {
        DSH_WSL_DISTRO: {
          description: 'The WSL distribution of the calling session workspace, when the session cwd is a WSL UNC path.',
        },
        DSH_WSL_USER: {
          description: 'The Linux user of the calling session workspace, when the workspace has one configured.',
        },
      },
      resolve(execution) {
        const cwd = execution.agent?.session.header.cwd
        const unc = cwd === undefined ? null : parseWslUnc(cwd)
        if (unc === null) return {}
        const username = getWorkspaceUsername(joinUnc(unc.distro, unc.linuxPath))
        return username === undefined || username === ''
          ? { DSH_WSL_DISTRO: unc.distro }
          : { DSH_WSL_DISTRO: unc.distro, DSH_WSL_USER: username }
      },
    }), 'dsh-wsl-workspace: per-session distro env fact')
  }

  const webServer = ctx.get('webServer') as unknown as WebServerService
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: resolved.route,
    handler: async (req, res) => {
      if (!isLoopback(req.socket.remoteAddress) || !isLoopbackHost(req.headers.host)) {
        json(res, 403, { ok: false, error: 'loopback-only' })
        return
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      let body: Record<string, unknown>
      try {
        body = await readBody(req)
      } catch (error) {
        json(res, 400, { ok: false, error: messageOf(error) })
        return
      }
      const method = typeof body.method === 'string' ? body.method : ''
      const params = body.params === undefined ? {} : body.params
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        json(res, 400, { ok: false, error: 'params must be an object' })
        return
      }
      try {
        const value = await dispatch(method, params as Record<string, unknown>)
        json(res, 200, { ok: true, value })
      } catch (error) {
        json(res, 200, { ok: false, error: messageOf(error) })
      }
    },
  }), 'dsh-wsl-workspace: dialog data route')
}
