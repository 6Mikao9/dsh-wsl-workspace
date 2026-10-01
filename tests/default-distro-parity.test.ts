/**
 * The two `defaultDistro` implementations must answer the same question the same way.
 *
 * `src/shared/wsl.ts` carries a pair: `defaultDistro()` (`:143-158`, async, parses
 * `textOf(stdout)`) and `defaultDistroSync()` (`:171-189`, `execFileSync` + `String(buffer)`),
 * the second one existing because a synchronous plan step cannot await. Two parsers over one
 * source drift: the repo has already shipped a case where a fix landed on one side only
 * (issue #44 lists `defaultDistro`/`defaultDistroSync` under double implementations), and the
 * reading that decides which spelling wins is `String(buffer)` versus `textOf(buffer)` — which
 * agree only because both decode UTF-8.
 *
 * Measured before writing this (this machine, `reg.exe query …Lxss /v DefaultDistribution`):
 * reg.exe writes **plain ASCII** (`0D 0A 48 4B 45 59 …`, 147 bytes, no NUL), so unlike
 * `wsl.exe` it is not a UTF-16LE source and this pair is not a §6 instance. That is a fact
 * about reg.exe on this build, not an assumption; if it changes, the parity assertion below is
 * the thing that goes red first.
 *
 * The guard is deliberately stronger than "both returned undefined": the fixture carries a
 * real name and the expected value is pinned, so a shared silent failure cannot read as
 * agreement. Who goes red when the pair is unified: nobody — one implementation cannot drift
 * from itself, which is the point.
 *
 *   node --test --experimental-strip-types tests/default-distro-parity.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GUID = '{ce0fc2a6-29d7-467c-996a-eab37c96b876}'
const DISTRO = 'Ubuntu-24.04 LTS'

/**
 * Drive both variants in one child process under the faked child_process. A child because the
 * sync variant caches at module scope for the process lifetime, and because the fake's
 * `--import` install is what proves the seam is the one the product uses.
 */
function probe(): Record<string, unknown> {
  const work = mkdtempSync(join(tmpdir(), 'dsh-distro-parity-'))
  try {
    const scriptPath = join(work, 'script.json')
    const probePath = join(work, 'probe.mjs')
    const reg = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'
    writeFileSync(scriptPath, JSON.stringify({
      calls: [
        {
          match: { file: 'reg.exe', argsContains: ['/v', 'DefaultDistribution'] },
          code: 0,
          stdout: { text: `\r\n${reg}\\${GUID}\r\n    DefaultDistribution    REG_SZ    ${GUID}\r\n\r\n` },
        },
        {
          match: { file: 'reg.exe', argsContains: ['/v', 'DistributionName'] },
          code: 0,
          stdout: { text: `\r\n${reg}\\${GUID}\r\n    DistributionName    REG_SZ    ${DISTRO}\r\n\r\n` },
        },
      ],
      default: 'error',
    }), 'utf8')
    writeFileSync(probePath, `
import { defaultDistro, defaultDistroSync } from ${JSON.stringify(
  pathToFileURL(join(repo, 'src', 'shared', 'wsl.ts')).href)}
const async1 = await defaultDistro()
const sync1 = defaultDistroSync()
console.log('PROBE:' + JSON.stringify({ async: async1 ?? null, sync: sync1 ?? null }))
`, 'utf8')
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      '--import', pathToFileURL(join(repo, 'tests', 'support', 'fake-child-process.mjs')).href,
      probePath,
    ], { encoding: 'utf8', env: { ...process.env, DSH_FAKE_CHILD_PROCESS: scriptPath }, timeout: 60_000 })
    const line = (result.stdout ?? '').split('\n').find((l) => l.startsWith('PROBE:'))
    if (line === undefined) {
      throw new Error(`probe produced no report (exit ${result.status}): `
        + `${String(result.stderr ?? '').slice(-700)}`)
    }
    return JSON.parse(line.slice('PROBE:'.length)) as Record<string, unknown>
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

test('the async and sync default-distro readers agree on one registry answer', () => {
  const report = probe()
  // Pinned first: each side individually must reach the real name, so agreement below cannot
  // be the agreement of two failures.
  assert.equal(report.async, DISTRO, `defaultDistro() reads the DistributionName (got ${JSON.stringify(report.async)})`)
  assert.equal(report.sync, DISTRO, `defaultDistroSync() reads the same value (got ${JSON.stringify(report.sync)})`)
  assert.equal(String(report.sync), String(report.async),
    `String(buffer) and textOf(buffer) parse to the same name (${JSON.stringify(report.async)})`)
})
