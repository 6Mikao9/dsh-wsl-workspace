// Machine-enforced version of the TESTING.md convention "the typecheck gate
// is that the count does not grow": count `error TS<n>` lines from
// `tsc --noEmit` and compare against ci/typecheck-baseline.json.
//   node scripts/typecheck-gate.mjs [--record]
// --record rewrites the baseline with the current count (maintenance
// machines / CI after a reviewed change). The baseline is environment-bound:
// standalone checkouts resolve @deepseek-ai types from the pinned ci/deps
// tree, the harness checkout resolves them from ../../vendor — record from
// the environment the gate runs in.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(repoRoot, 'ci', 'typecheck-baseline.json')
const record = process.argv.includes('--record')

const tsc = spawnSync(process.execPath, [
  join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-p', join(repoRoot, 'tsconfig.json'), '--noEmit',
], { encoding: 'utf8' })
const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`

// Premise checks, before any counting. `spawnSync` never throws when the program cannot
// run, and this tsc's exit status is not a usable signal — measured on this tree: a real
// run reporting all 212 baseline errors exits 2, a missing entry script exits 1 with an
// empty capture, and a usage banner exits 0. Counting `error TS` lines in whatever came
// back therefore read "zero errors, below baseline" and exited 0 for a run that
// typechecked nothing. So the gate asks whether the compiler was reachable at all, and
// refuses an empty capture that produced no measurement.
if (tsc.error !== undefined && tsc.error !== null) {
  console.error(`typecheck-gate: RED — tsc could not be run (${String(tsc.error)}); `
    + 'install build dependencies (`npm ci`) before running this gate')
  process.exit(1)
}
if (tsc.status === null || tsc.status === undefined) {
  console.error(`typecheck-gate: RED — tsc produced no exit status (signal ${String(tsc.signal)}); `
    + 'this is not a measurement')
  process.exit(1)
}
if (!existsSync(join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'))
  || !existsSync(join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js'))) {
  console.error('typecheck-gate: RED — the TypeScript compiler is not installed, so nothing was '
    + 'typechecked (`npm ci` first)')
  process.exit(1)
}
const errorLines = output.split('\n').filter(line => /error TS\d+/.test(line))
if (errorLines.length === 0 && /Synopses|Usage:|Options:/i.test(output)) {
  console.error(`typecheck-gate: RED — tsc printed a usage banner instead of typechecking:\n`
    + `${output.split('\n').filter(line => line.trim() !== '').slice(0, 6).join('\n')}`)
  process.exit(1)
}
if (errorLines.length === 0 && output.trim() === '') {
  console.error('typecheck-gate: RED — tsc produced no output at all; a genuinely clean tree '
    + 'still reports its exit status here, so counting zero would pass an unmeasured run')
  process.exit(1)
}

const errors = errorLines
const byFile = new Map()
for (const line of errors) {
  const file = line.split('(')[0]
  byFile.set(file, (byFile.get(file) ?? 0) + 1)
}

if (record) {
  writeFileSync(baselinePath, JSON.stringify({ errors: errors.length, recorded: new Date().toISOString().slice(0, 10) }, null, 2) + '\n')
  console.log(`typecheck-gate: recorded baseline ${errors.length} errors`)
  process.exit(0)
}

if (!existsSync(baselinePath)) {
  console.error('typecheck-gate: ci/typecheck-baseline.json missing — run `node scripts/typecheck-gate.mjs --record` in the target environment')
  process.exit(1)
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
if (errors.length > baseline.errors) {
  console.error(`typecheck-gate: RED — ${errors.length} errors vs baseline ${baseline.errors} (+${errors.length - baseline.errors})`)
  for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) console.error(`  ${count}  ${file}`)
  process.exit(1)
}
if (errors.length < baseline.errors) {
  console.log(`typecheck-gate: OK — ${errors.length} errors, below baseline ${baseline.errors}; consider --record to tighten`)
} else {
  console.log(`typecheck-gate: OK — ${errors.length} errors equals baseline`)
}
