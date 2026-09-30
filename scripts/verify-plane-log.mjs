// Assert that a driver log shows which plane it actually loaded.
//
// `scripts/compatibility/plane.mjs` prints one `plane-module: <key> -> <specifier>` line per
// subject module it resolves. This gate reads a driver's log and fails when the lines are
// missing or name a plane other than the one the run claimed. It exists because "the fs gate
// passed" and "the fs gate passed against lib/" are different claims, and only the log can tell
// them apart after the fact — the same reason `verify-lib.mjs` counts entries rather than
// trusting a zero-length loop.
//
//   node scripts/verify-plane-log.mjs <logfile> <src|lib> [expected-module ...]
//
// Exit codes: 0 satisfied, 1 mismatch or no evidence in the log, 2 usage/environment error.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [logPath, expectedPlane, ...expectedModules] = process.argv.slice(2)

if (logPath === undefined || expectedPlane === undefined) {
  console.error('usage: node scripts/verify-plane-log.mjs <logfile> <src|lib> [module ...]')
  process.exit(2)
}
if (expectedPlane !== 'src' && expectedPlane !== 'lib') {
  console.error(`verify-plane-log: expected plane must be src or lib, got ${JSON.stringify(expectedPlane)}`)
  process.exit(2)
}

let log
try {
  log = readFileSync(resolve(logPath), 'utf8')
} catch (error) {
  console.error(`verify-plane-log: cannot read ${logPath} (${String(error)})`)
  process.exit(2)
}

const found = [...log.matchAll(/^plane-module: (\S+) -> (\S+)$/gm)].map(m => ({ key: m[1], specifier: m[2] }))

// Zero lines is the failure that matters most: a driver that never resolved a plane has told us
// nothing, and a green gate whose evidence is absent must not read as a pass.
if (found.length === 0) {
  console.error(`verify-plane-log: RED — no "plane-module:" line in ${logPath}; the driver did not `
    + 'report which plane it loaded, so this run proves nothing about the plane')
  process.exit(1)
}

const problems = []
for (const { key, specifier } of found) {
  const prefix = specifier.split('/')[0]
  if (prefix !== expectedPlane) {
    problems.push(`${key} loaded from ${specifier}, expected a ${expectedPlane}/ module`)
  }
  // A hashed chunk or a file-local class is not a plane: it is scraping.
  if (/^[a-z]+-[A-Za-z0-9_]{6,}\.js$/.test(specifier.split('/').pop() ?? '')) {
    problems.push(`${key} loaded from content-hashed chunk ${specifier} — declare a tsdown entry instead`)
  }
}

for (const wanted of expectedModules) {
  if (!found.some(entry => entry.key === wanted)) problems.push(`no plane line for required module "${wanted}"`)
}

if (problems.length > 0) {
  console.error(`verify-plane-log: RED — ${logPath}`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log(`verify-plane-log: OK — ${found.length} plane line(s) in ${logPath}, all ${expectedPlane}`
  + (expectedModules.length > 0 ? `, covering ${expectedModules.join(', ')}` : ''))
