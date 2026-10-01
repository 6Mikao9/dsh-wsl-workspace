// Guard for the rank constants copied from @deepseek-ai/dsh-skill-filesystem
// (src/host/wsl-skills.ts). The host package does not export the constants,
// so this script parses them out of its built lib when the package is
// resolvable on this machine (repo node_modules, the pinned ci/deps tree, or
// the dsh profile mirror) and fails when our copies have drifted.
//   node scripts/check-rank-parity.mjs [--lenient]
// Comparison is strict by default: a host package that cannot be resolved used to print a
// warning and exit 0, so "nothing to compare" looked exactly like "nothing drifted". A
// machine that has no host tree installed must report that as a failure, which is what the
// --strict flag in the CI buckets was compensating for. `--strict` is still accepted as a
// no-op so existing TESTING.md and workflow invocations keep working. `--lenient` restores
// the old skip-green behaviour for a human who wants a warning instead of a verdict.
import { readFileSync } from 'node:fs'
import path, { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const strict = !process.argv.includes('--lenient')
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const ourSource = readFileSync(join(repoRoot, 'src', 'host', 'wsl-skills.ts'), 'utf8')

const OUR = {}
for (const [key, name] of [
  ['project-dsh', 'PROJECT_DSH_RANK'],
  ['project-agents', 'PROJECT_AGENTS_RANK'],
]) {
  const match = new RegExp(`const ${name} = (\\d+)`).exec(ourSource)
  if (match === null) {
    console.error(`check-rank-parity: cannot find ${name} in src/host/wsl-skills.ts`)
    process.exit(1)
  }
  OUR[key] = Number(match[1])
}

const hostCandidates = [
  join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'),
  join(repoRoot, 'ci', 'deps', 'node_modules', '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'),
  join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'),
]

// --host points the comparison at one explicit file. Without it the only way to prove the
// "host tree is missing" branch red is to move a real installed tree, which on this machine
// is a junction into the maintainer's live profile. Sentinels must not require that.
const hostArg = (() => {
  const i = process.argv.indexOf('--host')
  return i > 0 ? path.resolve(process.argv[i + 1]) : undefined
})()

let hostLib
if (hostArg !== undefined) {
  hostLib = readFileSync(hostArg, 'utf8')
  console.log(`check-rank-parity: comparing against ${hostArg} (explicit --host)`)
} else {
  for (const candidate of hostCandidates) {
    try {
      hostLib = readFileSync(candidate, 'utf8')
      console.log(`check-rank-parity: comparing against ${candidate}`)
      break
    } catch {
      // Try the next resolution root.
    }
  }
}
if (hostLib === undefined) {
  if (strict) {
    console.error('check-rank-parity: NOT VERIFIED — @deepseek-ai/dsh-skill-filesystem is not '
      + 'resolvable, so no comparison ran (run `node ci/install-pinned.mjs` first). '
      + 'This is a failure, not a skip; pass --lenient if you want a warning instead.')
    process.exit(1)
  }
  console.warn('check-rank-parity: @deepseek-ai/dsh-skill-filesystem not found on this machine; skipping comparison.')
  console.warn('  Re-run on a machine with the harness installed (or before release on the maintainer machine).')
  process.exit(0)
}

let failed = false
for (const [key, name] of [
  ['project-dsh', 'PROJECT_DSH_RANK'],
  ['project-agents', 'PROJECT_AGENTS_RANK'],
]) {
  const hostMatch = new RegExp(`const ${name} = (\\d+)`).exec(hostLib)
  if (hostMatch === null) {
    if (strict) {
      console.error(`check-rank-parity: NOT VERIFIED — host lib no longer declares ${name}; the comparison for ${key} did not run.`)
      failed = true
    } else {
      console.warn(`check-rank-parity: host lib no longer declares ${name} — re-check the host provider implementation by hand.`)
    }
    continue
  }
  const hostValue = Number(hostMatch[1])
  if (hostValue === OUR[key]) {
    console.log(`check-rank-parity: ${key} rank ${hostValue} matches our copy.`)
  } else {
    console.error(`check-rank-parity: ${key} rank drifted — host ${hostValue} vs our ${OUR[key]} (${name} in src/host/wsl-skills.ts).`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
