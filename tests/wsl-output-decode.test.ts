/**
 * wsl.exe output decoding, offline.
 *
 * `src/shared/wsl.ts:102` picks UTF-16LE by probing the captured buffer for a NUL byte.
 * Before this file the branch had no offline assertion at all — `grep -rn utf16 tests/`
 * found exactly one hit, `tests/exec-shape.mjs:42`, which needs a live distribution and a
 * win32 host. Every W1 check that decodes registry or wsl.exe output depends on this sniff,
 * so it is tested with synthetic buffers and a faked child_process: nothing here spawns
 * wsl.exe, which is what makes it runnable on the ubuntu runner.
 *
 *   node --test --experimental-strip-types tests/wsl-output-decode.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodeWslOutput, textOf, wslExecutableCandidates } from '../src/shared/wsl.ts'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('a UTF-16LE capture is decoded by its NUL bytes, not read as UTF-8', () => {
  const buffer = Buffer.from('Ubuntu\nDebian\n', 'utf16le')
  assert.ok(buffer.includes(0), 'the fixture really is UTF-16LE')
  assert.equal(decodeWslOutput(buffer), 'Ubuntu\nDebian\n')
})

test('a UTF-8 capture without NUL bytes is returned verbatim', () => {
  const buffer = Buffer.from('Ubuntu\nUbuntu-24.04\n', 'utf8')
  assert.equal(buffer.includes(0), false)
  assert.equal(decodeWslOutput(buffer), 'Ubuntu\nUbuntu-24.04\n')
})

test('an empty capture decodes to an empty string and never throws', () => {
  assert.equal(decodeWslOutput(Buffer.alloc(0)), '')
})

test('an odd-length buffer does not throw', () => {
  // Truncation is Node's documented behaviour; the gate cares that decoding never becomes
  // an exception on the discovery path, where a throw would read as "WSL is not installed".
  assert.doesNotThrow(() => decodeWslOutput(Buffer.from([0x55, 0, 0x00])))
})

test('a string that is not a buffer is reported, not silently treated as empty output', () => {
  // The 0.7.x crash class: a host wrapper that hands back something other than the captured
  // stream used to reach `.includes` on undefined.
  assert.equal(decodeWslOutput('already decoded'), 'already decoded')
  assert.throws(() => decodeWslOutput(null as unknown as Buffer), /expected captured output/)
  assert.throws(() => decodeWslOutput({} as unknown as Buffer), /expected captured output/)
})

test('textOf reads a captured stream as UTF-8 text', () => {
  assert.equal(textOf(Buffer.from('ok', 'utf8')), 'ok')
  assert.equal(textOf('ok'), 'ok')
})

test('the PATH-name spelling gains an absolute fallback, an explicit path does not', () => {
  // Issue #36: a host whose PATH omits System32 could run everything except listDistros.
  const original = process.env.SystemRoot
  try {
    process.env.SystemRoot = 'C:\\Windows'
    assert.deepEqual(wslExecutableCandidates('wsl.exe'), ['wsl.exe', 'C:\\Windows\\System32\\wsl.exe'])
    assert.deepEqual(wslExecutableCandidates('D:\\tools\\wsl.exe'), ['D:\\tools\\wsl.exe'])
    delete process.env.SystemRoot
    process.env.windir = 'D:\\Win'
    assert.deepEqual(wslExecutableCandidates('wsl.exe'), ['wsl.exe', 'D:\\Win\\System32\\wsl.exe'])
  } finally {
    if (original === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = original
  }
})

/** Run a probe in a child process under the faked child_process. */
function probeUnderFake(script: unknown): Record<string, unknown> {
  const work = mkdtempSync(join(tmpdir(), 'dsh-wsl-decode-'))
  try {
    const scriptPath = join(work, 'script.json')
    const probePath = join(work, 'probe.mjs')
    writeFileSync(scriptPath, JSON.stringify(script), 'utf8')
    writeFileSync(probePath, `
import { listDistros } from ${JSON.stringify(pathToFileURL(join(repo, 'src', 'shared', 'wsl.ts')).href)}
const report = { distros: null, error: null }
try {
  report.distros = await listDistros()
} catch (error) {
  report.error = String(error && error.message ? error.message : error)
}
console.log('PROBE:' + JSON.stringify(report))
`, 'utf8')
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      '--import', pathToFileURL(join(repo, 'tests', 'support', 'fake-child-process.mjs')).href,
      probePath,
    ], { encoding: 'utf8', env: { ...process.env, DSH_FAKE_CHILD_PROCESS: scriptPath }, timeout: 60_000 })
    const line = (result.stdout ?? '').split('\n').find(l => l.startsWith('PROBE:'))
    if (line === undefined) {
      throw new Error(`probe produced no report (exit ${result.status}): ${(result.stderr ?? '').slice(-700)}`)
    }
    return JSON.parse(line.slice('PROBE:'.length)) as Record<string, unknown>
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

test('listDistros() parses a UTF-16LE listing without spawning wsl.exe', () => {
  const report = probeUnderFake({
    calls: [{
      match: { file: 'wsl.exe', argsContains: ['-l', '-q'] },
      code: 0,
      stdout: { utf16le: 'Ubuntu\r\ndocker-desktop\r\n\r\nUbuntu-24.04\r\n' },
    }],
  })
  assert.equal(report.error, null, `listDistros must not throw: ${String(report.error)}`)
  // Blank lines dropped, order preserved, and no filtering here: dropping docker-desktop is
  // the caller's job (tests/smoke.ts does it), so this must not pin that policy.
  assert.deepEqual(report.distros, ['Ubuntu', 'docker-desktop', 'Ubuntu-24.04'])
})

test('a UTF-8 listing decodes through the same call site', () => {
  const report = probeUnderFake({
    calls: [{
      match: { file: 'wsl.exe', argsContains: ['-l', '-q'] },
      code: 0,
      stdout: { text: 'Ubuntu-22.04\n' },
    }],
  })
  assert.equal(report.error, null)
  assert.deepEqual(report.distros, ['Ubuntu-22.04'])
})

test('a failing wsl.exe is reported with the executables it tried, not as an empty list', () => {
  // The #35/#36 visible failure shape was an empty picker. An empty list and a reported
  // failure are different answers and must not be conflated.
  const report = probeUnderFake({
    calls: [{ match: { file: 'wsl.exe' }, code: 1, stderr: { text: 'The Windows Subsystem for Linux has not been enabled.' } }],
  })
  assert.equal(report.distros, null)
  assert.match(String(report.error), /cannot list WSL distributions/)
})
