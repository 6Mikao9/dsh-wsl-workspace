/**
 * Thin fetch client for the Host plugin route. The browser calls
 * POST /wsl-workspace/api with a `{ method, params }` envelope and the Host
 * answers `{ ok: true, value }` or `{ ok: false, error }`.
 */

/** Relative route the Host half registers (same-origin with the web server). */
const ENDPOINT = '/wsl-workspace/api'

/**
 * Upper bound for one host call. A hung route (e.g. a wedged `wsl.exe`) would
 * otherwise leave every dialog field disabled forever; the abort turns that
 * into a readable, retryable failure.
 */
const REQUEST_TIMEOUT_MS = 30_000

/** One directory entry as the Host lists it. */
export interface WslDirEntry {
  name: string
  kind: 'directory' | 'file' | 'other'
}

/** One directory level plus its breadcrumb ancestry. */
export interface WslDirListing {
  /** The listed absolute Linux path. */
  path: string
  /** Parent Linux path, or null at the filesystem root. */
  parent: string | null
  /** The level's children (in name order; the client filters to directories). */
  entries: WslDirEntry[]
}

/** Existence/directory check result for one Linux path. */
export interface WslPathCheck {
  exists: boolean
  isDirectory: boolean
}

/** Wire envelope the Host route answers with. The failure arm types `error`
 * as optional because a host can answer `{ok:false}` with no message at all —
 * that is the invisible-failure shape `call` below defends against. */
type Envelope<T> = { ok: true; value: T } | { ok: false; error?: string }

/** Human text for an unknown rejection, reusing the repository's idiom. */
function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** True for the rejection an `AbortSignal.timeout` produces (`TimeoutError`
 * in current engines, `AbortError` as a defensive spelling of the same). */
function isTimeout(value: unknown): boolean {
  return value instanceof Error && (value.name === 'TimeoutError' || value.name === 'AbortError')
}

/**
 * The per-call timeout signal. Every real browser (and Node) provides
 * `AbortSignal.timeout`; engines without it (e.g. a bare vm sandbox around a
 * faked fetch) get an untimed call instead of a ReferenceError, so the
 * timeout is only ever as unavailable as the platform itself.
 */
function callSignal(): AbortSignal | null {
  return typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : null
}

/**
 * Perform one POST call and unwrap the envelope.
 * @param method - the Host method name.
 * @param params - the method payload.
 * @returns the unwrapped value, or throws an Error on network or `ok:false`.
 * Every thrown Error carries a non-empty message: an empty one would render
 * the dialog's error box as an empty bordered strip.
 */
async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
      signal: callSignal(),
    })
  } catch (error) {
    if (isTimeout(error)) {
      throw new Error(`wsl-workspace request "${method}" timed out after ${REQUEST_TIMEOUT_MS} ms`)
    }
    // The transport refused before answering (offline, origin mismatch, 404).
    throw new Error(`wsl-workspace request failed: ${errorMessage(error)}`)
  }
  if (!response.ok) {
    // HTTP-level failure (the route's 403/405/400 fences, a proxy 5xx): name
    // the status, and append the envelope's error text when the body still
    // carries one so the readable cause is not lost.
    let detail = ''
    try {
      const body = (await response.json()) as Envelope<unknown>
      if (body.ok === false && typeof body.error === 'string' && body.error !== '') detail = `: ${body.error}`
    } catch {
      // No JSON to explain it; the status line is all there is.
    }
    throw new Error(`wsl-workspace request "${method}" failed (HTTP ${response.status})${detail}`)
  }
  let envelope: Envelope<T>
  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    // A non-JSON body means a proxy/loader answered instead of the Host route.
    throw new Error(`wsl-workspace answered non-JSON (${response.status})`)
  }
  if (!envelope.ok) {
    const reason = typeof envelope.error === 'string' && envelope.error !== ''
      ? envelope.error
      : `wsl-workspace request "${method}" failed without an error message from the host`
    throw new Error(reason)
  }
  return envelope.value
}

/**
 * List the WSL distros installed on the host.
 * @returns distro names in registry order.
 */
export async function listDistros(): Promise<string[]> {
  return call<string[]>('listDistros', {})
}

/**
 * List one directory level inside a distro.
 * @param distro - distro name.
 * @param path - absolute Linux directory to list.
 * @returns the level's listing with ancestry.
 */
export async function listDir(distro: string, path: string): Promise<WslDirListing> {
  return call<WslDirListing>('listDir', { distro, path })
}

/**
 * Check whether a Linux path exists and is a directory.
 * @param distro - distro name.
 * @param path - absolute Linux path.
 * @returns existence and directory facts.
 */
export async function check(distro: string, path: string): Promise<WslPathCheck> {
  return call<WslPathCheck>('check', { distro, path })
}

/**
 * Store (or clear, with an empty string) the username of one WSL workspace.
 * @param path - the workspace UNC path.
 * @param username - the Linux username; empty string clears the stored value.
 */
export async function setWorkspaceUser(path: string, username: string): Promise<void> {
  return call<void>('setUser', { path, username })
}

/**
 * Register a `/mnt/<drive>` WSL workspace under its Windows drive path,
 * recording the distro (and optional username) for the session env.
 * @param linuxPath - the `/mnt/<drive>/…` Linux path.
 * @param distro - the WSL distribution the workspace belongs to.
 * @param username - optional Linux username.
 */
export async function registerWindows(linuxPath: string, distro: string, username: string): Promise<void> {
  return call<void>('registerWindows', { linuxPath, distro, username })
}

/**
 * List every registered WSL workspace key (canonical UNC and Windows drive
 * spellings). The client uses the drive keys to recognize `/mnt` workspaces
 * across page reloads.
 */
export async function listWorkspaces(): Promise<string[]> {
  return call<string[]>('listWorkspaces', {})
}

/** One declared DSH release and its declared status. */
export interface WslDeclaredRelease {
  id: string
  status: string
}

/** Self-description of the running plugin build (shown by the help panel). */
export interface WslSelfDescription {
  version: string
  releases: WslDeclaredRelease[]
}

/**
 * Read the plugin build version and its declared DSH compatibility matrix,
 * for the dialog help panel.
 * @returns the self-description reported by the host plugin.
 */
export async function describe(): Promise<WslSelfDescription> {
  return call<WslSelfDescription>('describe', {})
}
