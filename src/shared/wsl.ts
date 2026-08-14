/**
 * WSL discovery helpers (host side): enumerate installed distributions
 * through `wsl.exe -l -q` and read the default distribution from the Lxss
 * registry key. `wsl.exe` output is UTF-16LE on most builds, so decoding
 * sniffs for NUL bytes before choosing an encoding.
 * @module dsh-wsl-workspace/shared/wsl
 */

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Executable timeout for the short discovery calls. */
const DISCOVERY_TIMEOUT_MS = 10_000

const LXSS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'

/** Human text for an unknown rejection. */
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * Decode `wsl.exe -l -q` output. Newer builds emit UTF-8; most emit UTF-16LE
 * with NUL bytes interleaved — the NUL probe picks the right one.
 * @param buffer - the raw captured output.
 * @returns the decoded text.
 */
export function decodeWslOutput(buffer: Buffer): string {
  return buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf8')
}

/**
 * List installed WSL distributions in `wsl.exe` order.
 * @param wslPath - the `wsl.exe` executable (absolute or PATH name).
 * @returns distribution names, blank lines dropped.
 */
export async function listDistros(wslPath = 'wsl.exe'): Promise<string[]> {
  let stdout: Buffer
  try {
    const result = await execFileAsync(wslPath, ['-l', '-q'], { encoding: 'buffer', timeout: DISCOVERY_TIMEOUT_MS })
    stdout = result.stdout as Buffer
  } catch (error) {
    throw new Error(`wsl-workspace: cannot list WSL distributions (${messageOf(error)}); is WSL installed?`)
  }
  return decodeWslOutput(stdout)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

/**
 * Read the user's default distribution from the Lxss registry. Non-fatal:
 * returns `undefined` when the value is absent or unreadable (the caller
 * falls back to list order).
 * @returns the default distribution name, or `undefined`.
 */
export async function defaultDistro(): Promise<string | undefined> {
  try {
    const value = await execFileAsync('reg.exe', ['query', LXSS_KEY, '/v', 'DefaultDistribution'], {
      timeout: DISCOVERY_TIMEOUT_MS,
    })
    const guid = /DefaultDistribution\s+REG_SZ\s+(\{[0-9a-fA-F-]+\})/i.exec(value.stdout)?.[1]
    if (guid === undefined) return undefined
    const name = await execFileAsync('reg.exe', ['query', `${LXSS_KEY}\\${guid}`, '/v', 'DistributionName'], {
      timeout: DISCOVERY_TIMEOUT_MS,
    })
    const distro = /DistributionName\s+REG_SZ\s+(.+)/i.exec(name.stdout)?.[1]?.trim()
    return distro === undefined || distro === '' ? undefined : distro
  } catch {
    return undefined
  }
}

/** Module-level cache for {@link defaultDistroSync} (one registry read per process). */
let syncDefaultResolved = false
let syncDefault: string | undefined

/**
 * Synchronous variant of {@link defaultDistro} for executors that must
 * resolve a distribution inside a synchronous plan step. Cached after the
 * first read; non-fatal (returns `undefined` when the registry is
 * unreadable, letting the caller fail loud with its own message).
 * @returns the default distribution name, or `undefined`.
 */
export function defaultDistroSync(): string | undefined {
  if (syncDefaultResolved) return syncDefault
  syncDefaultResolved = true
  try {
    const value = execFileSync('reg.exe', ['query', LXSS_KEY, '/v', 'DefaultDistribution'], {
      timeout: DISCOVERY_TIMEOUT_MS,
    })
    const guid = /DefaultDistribution\s+REG_SZ\s+(\{[0-9a-fA-F-]+\})/i.exec(String(value))?.[1]
    if (guid === undefined) return undefined
    const name = execFileSync('reg.exe', ['query', `${LXSS_KEY}\\${guid}`, '/v', 'DistributionName'], {
      timeout: DISCOVERY_TIMEOUT_MS,
    })
    const distro = /DistributionName\s+REG_SZ\s+(.+)/i.exec(String(name))?.[1]?.trim()
    syncDefault = distro === undefined || distro === '' ? undefined : distro
  } catch {
    syncDefault = undefined
  }
  return syncDefault
}
