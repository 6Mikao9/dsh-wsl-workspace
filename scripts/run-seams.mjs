/**
 * Run the seam suites without letting the first red hide the second.
 *
 * `test:node` is an `&&` chain, and a CI step that fails skips the steps after it, so several red
 * reproductions in sequence report as one. This runner spawns each suite, prints its verdict and
 * every `not ok:` / `SKIP:` line it produced, and exits with the COUNT of failed suites — so one
 * red step carries every red's name.
 *
 *   node scripts/run-seams.mjs
 */

import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** [label, argv] — argv is what the repo's own gates advertise for that suite. */
const SUITES = [
  ['route-envelope (§6 exists:false fold)', ['tests/route-envelope.mjs']],
  ['search-run-fakes (§6 transport seams)', ['tests/search-run-fakes.mjs']],
  ['tech-debt-exposure (cmd.exe fallback, registry decode, NUL sniff)',
    ['--test', '--experimental-strip-types', 'tests/tech-debt-exposure.test.ts']],
]

let failed = 0
for (const [label, argv] of SUITES) {
  const result = spawnSync(process.execPath, argv, { cwd: repo, encoding: 'utf8', timeout: 900_000 })
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const lines = out.split('\n')
  const verdict = lines.filter(l => /PASSED|FAILED \(\d+ failing\)|^# (pass|fail) \d+|^ℹ (tests|pass|fail) \d+/
    .test(l.trim())).map(l => l.trim().replace(/^ℹ /, '')).join(' / ')
  const notOk = lines.filter(l => l.startsWith('not ok:') || l.startsWith('✖ ')).map(l => l.trim())
  const skipped = lines.filter(l => l.startsWith('SKIP:')).map(l => l.trim())
  console.log(`\n=== ${label}: rc ${result.status} — ${verdict || '(no verdict line)'} ===`)
  for (const line of notOk) console.error(`  ${line}`)
  for (const line of skipped) console.warn(`  ${line}`)
  if (result.status !== 0) failed += 1
  if (result.error !== undefined) {
    console.error(`  harness error running ${label}: ${String(result.error.message)}`)
    failed += 1
  }
}
console.log(`\nrun-seams: ${failed} of ${SUITES.length} suite(s) red`)
process.exit(failed === 0 ? 0 : 1)
