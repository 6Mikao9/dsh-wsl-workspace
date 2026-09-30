#!/usr/bin/env node
// `lib/` is committed and published verbatim, so the only thing that makes the bundle
// trustworthy is that its exact bytes are in the commit. Two gates already compare a rebuild
// against the checkout (`ci.yml`'s byte-for-byte step, `scripts/verify-artifact-identity.mjs`),
// but neither runs on the publish path: `prepublishOnly` was only `verify:install`, so the
// "lib was hand-patched earlier" class (`c3be1fd`'s own wording) had no gate at the moment it
// mattered.
//
// This script answers a different question from those two: is the WORKING TREE's lib/ exactly
// what HEAD says it is? It is cheap, runs before any build, and sees the two shapes `git diff`
// cannot: an untracked new chunk and a file deleted from disk but still in HEAD.
//
//   node scripts/verify-lib-sync.mjs              # dirty tree is a failure (publish path)
//   node scripts/verify-lib-sync.mjs --check-only # same verdict; CI's pre-build step
//
// Exit codes: 0 clean, 1 lib/ differs from HEAD, 2 usage/environment error.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// Accepted as an explicit spelling of the default, so CI can say what it means. This check
// never rebuilds and never writes, so there is no "check only" mode distinct from the normal
// one; a fresh CI checkout has nothing untracked, which is exactly why the step is placed
// before the rebuild — there, the rebuild is what would otherwise hide a stale commit.
if (process.argv.includes('--help')) {
  console.log('usage: node scripts/verify-lib-sync.mjs [--check-only]')
  process.exit(0)
}

function git(args) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (r.error !== undefined && r.error !== null) {
    console.error(`verify-lib-sync: cannot run git (${String(r.error)}) — the check needs a git checkout`)
    process.exit(2)
  }
  if (r.status !== 0) {
    console.error(`verify-lib-sync: git ${args.join(' ')} failed (exit ${r.status}):\n${r.stderr ?? ''}`)
    process.exit(2)
  }
  return (r.stdout ?? '').replace(/\r?\n$/, '')
}

const status = git([
  'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching', '--', 'lib',
])
// Both sides compared as bare file names: `git ls-files` returns `lib/<name>` paths and
// readdirSync returns names, so comparing them verbatim reports every file as both missing
// and extra.
const tracked = git(['ls-files', '--', 'lib'])
  .split('\n').filter(line => line.trim() !== '').map(line => line.split('/').pop()).sort()
const onDisk = readdirSync(join(repoRoot, 'lib'))
  .filter(name => name.endsWith('.js') || name.endsWith('.js.map'))
  .sort()

const problems = []
if (status !== '') {
  problems.push('lib/ differs from HEAD in the working tree:')
  for (const line of status.split('\n')) problems.push(`    ${line}`)
}
const missing = tracked.filter(name => !onDisk.includes(name))
const extra = onDisk.filter(name => !tracked.includes(name))
if (missing.length > 0) problems.push(`tracked in HEAD but absent from disk: ${missing.join(', ')}`)
if (extra.length > 0) problems.push(`on disk but not tracked in HEAD: ${extra.join(', ')}`)

if (problems.length > 0) {
  console.error('verify-lib-sync: RED —')
  for (const line of problems) console.error(`  ${line}`)
  console.error('Commit the rebuilt bundle (`npm run build`, then add the exact lib/ paths), or restore it:')
  console.error('  git restore --source=HEAD --staged --worktree -- lib')
  process.exit(1)
}

console.log(`verify-lib-sync: OK — lib/ matches HEAD exactly (${onDisk.length} files, `
  + `${tracked.length} tracked).`)
