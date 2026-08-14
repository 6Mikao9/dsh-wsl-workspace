/**
 * Thin fetch client for the Host plugin route. The browser calls
 * POST /wsl-workspace/api with a `{ method, params }` envelope and the Host
 * answers `{ ok: true, value }` or `{ ok: false, error }`.
 */

/** Relative route the Host half registers (same-origin with the web server). */
const ENDPOINT = '/wsl-workspace/api'

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

/** Wire envelope the Host route answers with. */
type Envelope<T> = { ok: true; value: T } | { ok: false; error: string }

/** Human text for an unknown rejection, reusing the repository's idiom. */
function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * Perform one POST call and unwrap the envelope.
 * @param method - the Host method name.
 * @param params - the method payload.
 * @returns the unwrapped value, or throws an Error on network or `ok:false`.
 */
async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })
  } catch (error) {
    // The transport refused before answering (offline, origin mismatch, 404).
    throw new Error(`wsl-workspace request failed: ${errorMessage(error)}`)
  }
  let envelope: Envelope<T>
  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    // A non-JSON body means a proxy/loader answered instead of the Host route.
    throw new Error(`wsl-workspace answered non-JSON (${response.status})`)
  }
  if (!envelope.ok) throw new Error(envelope.error)
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
