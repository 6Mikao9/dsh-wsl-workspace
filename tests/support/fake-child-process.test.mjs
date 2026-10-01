// Self-test for tests/support/fake-child-process.mjs.
//
// The fake is only useful if a *static ESM import* of `execFile` actually reaches it, so this
// probe imports it that way and reports what it observed. It asserts the two-sided control:
// armed under `--import`, not armed without. A fixture whose positive control cannot fail is
// the thing this repo keeps getting wrong, so it gets its own test.
//
//   node --test tests/support/fake-child-process.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
// pathToFileURL, not `file://${…}`: on Windows the path arrives with backslashes and a drive
// letter, and the ESM loader rejects it as an unsupported URL scheme.
const fakeUrl = pathToFileURL(join(here, 'fake-child-process.mjs')).href

const PROBE = `
import { execFile } from 'node:child_process'
import { fakeArmed, fakeCalls } from ${JSON.stringify(fakeUrl)}

execFile('wsl.exe', ['-l', '-q'], { encoding: 'buffer' }, (error, stdout, stderr) => {
  const report = {
    armed: fakeArmed(),
    calls: fakeCalls().length,
    error: error ? { message: error.message, code: error.code, signal: error.signal } : null,
    stdoutIsBuffer: Buffer.isBuffer(stdout),
    decodedUtf16: Buffer.isBuffer(stdout) ? stdout.toString('utf16le') : String(stdout),
    sawWindowsHide: fakeCalls()[0]?.options?.windowsHide ?? null,
  }
  console.log('PROBE:' + JSON.stringify(report))
})
`

/** Run the probe under the fake, with one scripted answer. */
function run(scriptObject) {
  const work = mkdtempSync(join(tmpdir(), 'dsh-fake-cp-'))
  try {
    const scriptPath = join(work, 'script.json')
    const probePath = join(work, 'probe.mjs')
    writeFileSync(scriptPath, JSON.stringify(scriptObject), 'utf8')
    writeFileSync(probePath, PROBE, 'utf8')
    const result = spawnSync(process.execPath, [
      '--import', fakeUrl,
      probePath,
    ], { encoding: 'utf8', env: { ...process.env, DSH_FAKE_CHILD_PROCESS: scriptPath }, timeout: 60_000 })
    const line = (result.stdout ?? '').split('\n').find(l => l.startsWith('PROBE:'))
    if (line === undefined) {
      throw new Error(`probe produced no report (exit ${result.status}): ${(result.stderr ?? '').slice(-800)}`)
    }
    return { report: JSON.parse(line.slice(6)), result }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

test('a scripted answer reaches a static ESM import of execFile', () => {
  const { report } = run({
    calls: [{ match: { file: 'wsl.exe', argsContains: ['-l'] }, code: 0, stdout: { utf16le: 'Ubuntu\nDebian\n' } }],
  })
  assert.equal(report.armed, true, 'the fake must report it answered a call')
  assert.equal(report.calls, 1)
  assert.equal(report.error, null)
  assert.equal(report.stdoutIsBuffer, true, 'the caller asked for encoding: buffer')
  assert.equal(report.decodedUtf16, 'Ubuntu\nDebian\n')
})

test('the positive control: without --import the fake is not armed', () => {
  const work = mkdtempSync(join(tmpdir(), 'dsh-fake-cp-'))
  try {
    const probePath = join(work, 'probe.mjs')
    // Imports the fake module (so fakeArmed() exists) but never installs it.
    writeFileSync(probePath, PROBE, 'utf8')
    const result = spawnSync(process.execPath, [probePath], {
      encoding: 'utf8',
      env: { ...process.env, DSH_FAKE_CHILD_PROCESS: '' },
      timeout: 60_000,
    })
    const line = (result.stdout ?? '').split('\n').find(l => l.startsWith('PROBE:'))
    assert.notEqual(line, undefined, `unpatched probe must still answer (exit ${result.status})`)
    const report = JSON.parse(line.slice(6))
    assert.equal(report.armed, false, 'the counter cannot be armed when the wrapper never ran')
    assert.equal(report.calls, 0)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('installing is what arms it: a static import alone does nothing', () => {
  const work = mkdtempSync(join(tmpdir(), 'dsh-fake-cp-'))
  try {
    writeFileSync(join(work, 'probe.mjs'), `
import { execFile } from 'node:child_process'
import { fakeArmed, installFakeChildProcess } from ${JSON.stringify(fakeUrl)}
console.log('PROBE:' + JSON.stringify({ beforeImport: fakeArmed() }))
installFakeChildProcess()
execFile('wsl.exe', ['-l'], { encoding: 'buffer' }, () => {
  console.log('AFTER:' + JSON.stringify({ armed: fakeArmed() }))
})
`, 'utf8')
    const result = spawnSync(process.execPath, [join(work, 'probe.mjs')], {
      encoding: 'utf8', env: { ...process.env, DSH_FAKE_CHILD_PROCESS: '' }, timeout: 60_000,
    })
    const out = result.stdout ?? ''
    const before = JSON.parse(out.split('\n').find(l => l.startsWith('PROBE:'))?.slice(6) ?? '{}')
    const after = JSON.parse(out.split('\n').find(l => l.startsWith('AFTER:'))?.slice(6) ?? '{}')
    assert.equal(before.beforeImport, false, 'importing the library must not patch anything')
    assert.equal(after.armed, true, 'installFakeChildProcess() must reach a static ESM import')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('an unmatched call is reported as a fixture gap, never spawned for real', () => {
  const { report } = run({ calls: [{ match: { file: 'something-else.exe' }, code: 0, stdout: '' }] })
  assert.equal(report.armed, true)
  assert.equal(report.error?.code, 'FAKE_UNMATCHED')
  assert.match(report.error.message, /no scripted answer for wsl\.exe/)
})

test('a scripted SIGKILL arrives as a killed error with the options the caller passed', () => {
  const { report } = run({
    calls: [{ match: { file: 'wsl.exe' }, code: null, signal: 'SIGKILL', killed: true, stderr: 'gone' }],
  })
  assert.equal(report.error?.signal, 'SIGKILL')
  assert.equal(report.error?.code, undefined, 'a killed run carries no exit code')
  assert.equal(report.sawWindowsHide, null, 'the fake must not invent options the caller did not pass')
})
