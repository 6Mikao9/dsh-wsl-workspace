// Derive the shipped lib/ entry names from tsdown.config.ts, the one place that
// declares them. A gate that re-typed this list would be a second source of truth.
//
// Used by scripts/verify-lib.mjs (entry floor) and scripts/compatibility/plane.mjs
// (which may load src/ and which may load lib/).
//
//   import { libEntryNames, isLibEntry } from '../scripts/support/lib-entries.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let cached

/** The config is a build-time dependency, so an unresolved import is reported, not swallowed. */
async function loadConfig() {
  if (cached !== undefined) return cached
  let config
  try {
    // pathToFileURL, not the bare absolute path: on Windows the ESM loader rejects
    // `import('D:\\…')` with ERR_UNSUPPORTED_ESM_URL_SCHEME (protocol 'd:').
    config = (await import(pathToFileURL(join(repoRoot, 'tsdown.config.ts')).href)).default
  } catch (error) {
    throw new Error(
      `lib-entries: cannot import tsdown.config.ts to derive the entry list (${String(error)}); `
      + 'install build dependencies (`npm ci`) before running entry-count gates',
    )
  }
  const builds = Array.isArray(config) ? config : [config]
  const names = builds.flatMap((build) => Object.keys(build.entry ?? {}))
  if (names.length === 0) {
    throw new Error('lib-entries: tsdown.config.ts declares no entry points — refusing to report a floor of 0')
  }
  cached = [...new Set(names)].map((name) => `${name}.js`)
  return cached
}

/** Every declared entry as a `lib/` file name. */
export async function libEntryNames() {
  return await loadConfig()
}

/** True when `name` (bare or `x.js`) is a declared entry rather than a hashed chunk. */
export async function isLibEntry(name) {
  const entries = await loadConfig()
  return entries.includes(name.endsWith('.js') ? name : `${name}.js`)
}

/** The entry key for a driver-facing module id such as `fs` or `wsl-search`. */
export async function entryFor(key) {
  const entries = await loadConfig()
  const file = key.endsWith('.js') ? key : `${key}.js`
  return entries.includes(file) ? file : undefined
}
