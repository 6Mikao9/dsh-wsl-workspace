// Guard for the rank constants copied from @deepseek-ai/dsh-skill-filesystem
// (src/host/wsl-skills.ts). The host package does not export the constants,
// so this script parses them out of its built lib when the package is
// resolvable on this machine (repo node_modules or the dsh profile mirror)
// and fails when our copies have drifted.
//   node scripts/check-rank-parity.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'),
]

let hostLib
for (const candidate of hostCandidates) {
  try {
    hostLib = readFileSync(candidate, 'utf8')
    console.log(`check-rank-parity: comparing against ${candidate}`)
    break
  } catch {
    // Try the next resolution root.
  }
}
if (hostLib === undefined) {
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
    console.warn(`check-rank-parity: host lib no longer declares ${name} — re-check the host provider implementation by hand.`)
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
