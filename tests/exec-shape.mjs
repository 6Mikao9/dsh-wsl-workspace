/**
 * Regression test for issue #35: a host that replaces `child_process.execFile`
 * with a plain wrapper (DSH Desktop injects `windowsHide: true` that way)
 * strips `util.promisify.custom`, so `promisify(execFile)` resolves the captured
 * stdout instead of `{ stdout, stderr }`. `listDistros()` threw
 * `Cannot read properties of undefined (reading 'includes')`, `defaultDistro()`
 * silently returned `undefined`, and `resolveLinuxSymlink()` silently resolved
 * nothing.
 *
 * This boots a child process with such a wrapper installed and asserts the
 * plugin's three call sites still answer correctly — and that the wrapper really
 * does arm the defect, so a passing run cannot be a no-op.
 *
 *   node --experimental-strip-types tests/exec-shape.mjs
 *
 * @module dsh-wsl-workspace/tests/exec-shape
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { joinUnc } from '../src/shared/paths.ts'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const assert = (condition, label) => {
  if (condition) {
    console.log(`ok: ${label}`)
    return
  }
  failures += 1
  console.error(`not ok: ${label}`)
}

/** The first installed distribution, or undefined when there is none. */
function firstDistro() {
  try {
    const out = execFileSync('wsl.exe', ['-l', '-q'], { encoding: 'buffer', timeout: 20_000 })
    return out
      .toString('utf16le')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('docker-desktop'))[0]
  } catch {
    return undefined
  }
}

const distro = firstDistro()
assert(distro !== undefined, `a WSL distribution is installed (found ${distro ?? 'none'})`)
if (distro === undefined) {
  console.error('exec-shape: no distribution to test against')
  process.exit(1)
}

// A symlink only the distribution can resolve, for the links.ts call site.
const LINK = '/tmp/dsh-exec-shape-link'
const TARGET = '/tmp/dsh-exec-shape-target'
execFileSync('wsl.exe', ['-d', distro, '--', 'ln', '-sfn', TARGET, LINK], { timeout: 20_000 })

const work = mkdtempSync(join(tmpdir(), 'dsh-exec-shape-'))
try {
  // The stand-in for DSH Desktop's `resources/windows-child-process-hide.mjs`:
  // plain functions over the originals, then the ESM named exports re-synced.
  writeFileSync(join(work, 'wrapper.mjs'), `
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
const originalExec = childProcess.exec
const originalExecFile = childProcess.execFile
childProcess.exec = function patchedExec(file, args, options, callback) {
  if (typeof args === 'function') return originalExec.call(this, file, { windowsHide: true }, undefined, args)
  if (typeof options === 'function') return originalExec.call(this, file, args, { windowsHide: true }, options)
  return originalExec.call(this, file, args, { ...(options ?? {}), windowsHide: true }, callback)
}
childProcess.execFile = function patchedExecFile(file, args, options, callback) {
  if (typeof args === 'function') return originalExecFile.call(this, file, { windowsHide: true }, undefined, args)
  if (typeof options === 'function') return originalExecFile.call(this, file, args, { windowsHide: true }, options)
  return originalExecFile.call(this, file, args, { ...(options ?? {}), windowsHide: true }, callback)
}
syncBuiltinESMExports()
`, 'utf8')

  const wslModule = pathToFileURL(join(repo, 'src', 'shared', 'wsl.ts')).href
  const linksModule = pathToFileURL(join(repo, 'src', 'shared', 'links.ts')).href
  const pathsModule = pathToFileURL(join(repo, 'src', 'shared', 'paths.ts')).href
  writeFileSync(join(work, 'probe.mjs'), `
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listDistros, defaultDistro } from ${JSON.stringify(wslModule)}
import { resolveLinuxSymlink } from ${JSON.stringify(linksModule)}
import { joinUnc } from ${JSON.stringify(pathsModule)}

const execFileAsync = promisify(execFile)

// Is the defect armed? Under the wrapper this must be true.
let promisifyShapeBroken = false
try {
  const shaped = await execFileAsync('reg.exe', ['query', 'HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Lxss', '/v', 'DefaultDistribution'])
  promisifyShapeBroken = shaped === null || typeof shaped !== 'object' || shaped.stdout === undefined
} catch {
  // A missing registry value says nothing about the shape; leave it false.
}

const report = { promisifyShapeBroken }
try {
  report.distros = await listDistros()
} catch (error) {
  report.distrosError = String(error && error.message ? error.message : error)
}
report.defaultDistro = (await defaultDistro()) ?? null
try {
  report.link = (await resolveLinuxSymlink(joinUnc(${JSON.stringify(distro)}, ${JSON.stringify(LINK)}))) ?? null
} catch (error) {
  report.linkError = String(error && error.message ? error.message : error)
}
console.log('PROBE:' + JSON.stringify(report))
`, 'utf8')

  /** Run the probe, optionally with the wrapper installed. */
  function probe(wrapped) {
    const argv = [join(work, 'probe.mjs'), '--experimental-strip-types']
    if (wrapped) argv.unshift('--import', pathToFileURL(join(work, 'wrapper.mjs')).href)
    const result = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 60_000 })
    const line = (result.stdout ?? '').split('\n').find(candidate => candidate.startsWith('PROBE:'))
    if (line === undefined) {
      throw new Error(`probe produced no report (exit ${result.status}): ${(result.stderr ?? '').slice(-600)}`)
    }
    return JSON.parse(line.slice('PROBE:'.length))
  }

  const wrapped = probe(true)
  const plain = probe(false)

  assert(wrapped.promisifyShapeBroken === true,
    'the wrapper really strips promisify metadata (otherwise this test proves nothing)')
  assert(plain.promisifyShapeBroken === false,
    'without the wrapper promisify(execFile) still resolves { stdout, stderr }')

  for (const [label, report] of [['wrapped', wrapped], ['plain', plain]]) {
    assert(report.distrosError === undefined, `${label}: listDistros() does not throw (${report.distrosError ?? ''})`)
    assert(Array.isArray(report.distros) && report.distros.includes(distro),
      `${label}: listDistros() reports ${distro}`)
    assert(report.defaultDistro === distro,
      `${label}: defaultDistro() reports ${distro} (got ${String(report.defaultDistro)})`)
    assert(report.link === joinUnc(distro, TARGET),
      `${label}: resolveLinuxSymlink() resolves the link to ${TARGET} (got ${String(report.link)})`)
  }
  assert(JSON.stringify(wrapped.distros) === JSON.stringify(plain.distros),
    'the wrapped and unwrapped runs agree on the distribution list')
} finally {
  rmSync(work, { recursive: true, force: true })
  try {
    execFileSync('wsl.exe', ['-d', distro, '--', 'rm', '-f', LINK], { timeout: 20_000 })
  } catch {
    // best effort fixture cleanup
  }
}

const total = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(line => /assert\(/.test(line)).length
console.log(failures === 0
  ? `EXEC SHAPE PASSED (${total} assertion sites)`
  : `EXEC SHAPE FAILED (${failures} failing)`)
process.exit(failures === 0 ? 0 : 1)
