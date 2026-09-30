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
const errors = output.split('\n').filter(line => /error TS\d+/.test(line))
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
