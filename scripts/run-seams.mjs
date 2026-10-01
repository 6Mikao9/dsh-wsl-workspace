/**
 * Run the seam suites without letting the first red hide the second.
 *
 * `test:node` is an `&&` chain, and a CI step that fails also skips the steps after it, so two
 * red reproductions in sequence report as one. This runner spawns each suite, prints its verdict
 * line and its failing assertions, and exits with the COUNT of failed suites — so one red step
 * carries every red's name.
 *
 *   node scripts/run-seams.mjs
 */

import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUITES = [
  ['route-envelope (§6 exists:false fold)', join(repo, 'tests', 'route-envelope.mjs')],
  ['search-run-fakes (§6 transport seams)', join(repo, 'tests', 'search-run-fakes.mjs')],
]

let failed = 0
for (const [label, file] of SUITES) {
  const result = spawnSync(process.execPath, [file], { cwd: repo, encoding: 'utf8', timeout: 900_000 })
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const verdict = out.split('\n').filter(l => /PASSED|FAILED \(\d+ failing\)/.test(l)).join(' / ').trim()
  const notOk = out.split('\n').filter(l => l.startsWith('not ok:')).map(l => l.trim())
  const skipped = out.split('\n').filter(l => l.startsWith('SKIP:')).map(l => l.trim())
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
