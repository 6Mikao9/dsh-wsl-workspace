/**
 * Pre-publish gate: can a *plain npm* user actually install this package?
 *
 * 0.7.0 shipped with `peerDependencies` that npm auto-installs: the
 * `@deepseek-ai/dsh-tool-fs-search` peer pulls `@deepseek-ai/dsh-retention`,
 * which is not published, so `npm install dsh-wsl-workspace` died with E404 —
 * while `dsh plugin add` (pnpm) only warned and installed fine. Every harness
 * check and real session used the pnpm path, so nothing caught it; the first
 * plain-npm install happened after the release. This script is that missing
 * check, and `prepublishOnly` runs it, so an uninstallable package cannot be
 * published again.
 *
 * It packs the current tree, installs the tarball into a scratch directory with
 * the npm on PATH (no pnpm, no workspace, no host packages present), and fails
 * on a non-zero exit or a version mismatch. Child processes inherit stdio: the
 * sandbox forbids piped stdio for spawned programs, and the exit status is all
 * this needs.
 *
 * @module dsh-wsl-workspace/scripts/verify-install
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))

/**
 * Run one npm command in a directory, inheriting stdio, and return its status.
 *
 * npm's own entry script is used when npm exposes it (`npm_execpath`, set for
 * every lifecycle script including `prepublishOnly`), which avoids a shell
 * entirely. On Windows a bare `npm.cmd` cannot be spawned without one, so the
 * fallback — running this file by hand, outside npm — goes through the shell.
 * Nothing here takes user input: the arguments are this file's own literals.
 * @param args - npm arguments.
 * @param cwd - working directory.
 * @returns the exit status.
 */
function runNpm(args, cwd) {
  const execpath = process.env.npm_execpath
  if (execpath !== undefined && execpath.endsWith('.js')) {
    return spawnSync(process.execPath, [execpath, ...args], { cwd, stdio: 'inherit' }).status ?? 1
  }
  const program = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return spawnSync(program, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1
}

/** Fail loudly with one line, so the gate is readable in a publish log. */
function fail(message) {
  console.error(`verify-install: ${message}`)
  process.exit(1)
}

console.log(`verify-install: packing ${manifest.name}@${manifest.version} ...`)
if (runNpm(['pack', '--silent'], repo) !== 0) fail('npm pack failed')

// `npm pack` prints the tarball name on stdout, which inherited stdio swallowed;
// the deterministic name is the manifest's.
const tarball = join(repo, `${manifest.name}-${manifest.version}.tgz`)
const scratch = mkdtempSync(join(tmpdir(), 'dsh-verify-install-'))
try {
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'verify-install', private: true, version: '1.0.0' }, null, 2))
  console.log('verify-install: installing the tarball with plain npm (no pnpm, no peers present) ...')
  const status = runNpm(['install', tarball, '--no-audit', '--no-fund', '--prefer-online'], scratch)
  if (status !== 0) {
    fail(`plain \`npm install ${manifest.name}@${manifest.version}\` failed with exit ${status} - a user installing this package with npm cannot complete the install`)
  }
  const installed = JSON.parse(readFileSync(join(scratch, 'node_modules', manifest.name, 'package.json'), 'utf8'))
  if (installed.version !== manifest.version) fail(`installed version ${installed.version} is not ${manifest.version}`)
  console.log(`verify-install: OK - plain npm installs ${manifest.name}@${installed.version}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
  rmSync(tarball, { force: true })
}
