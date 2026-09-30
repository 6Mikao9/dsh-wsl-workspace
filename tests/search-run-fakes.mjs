/**
 * The search executor's spawn contract, driven offline through the registered `grep` tool.
 *
 * `src/host/wsl-search.ts:822-857` runs
 * `execFile(wslPath, argv, {maxBuffer, encoding:'buffer', timeout, killSignal:'SIGKILL',
 * windowsHide, ...signal})` and classifies the result at `:860-908`. Before this file that
 * code had no offline test at all:
 * `grep -c 'SIGKILL|runInDistro|killSignal' tests/wsl-search.test.ts` is 0 — every branch
 * below is reachable only against a live distribution, which is exactly why a dropped
 * `killSignal` or a mis-classified exit code can ship unnoticed.
 *
 * Mechanism: the registered `child_process` fake
 * (`tests/support/fake-child-process.mjs`, installed with `--import` so it is armed before
 * `lib/wsl-search.js` loads) answers the spawn, and the probe drives the tool's own
 * `execute` — the same reach `tests/wsl-search.test.ts:334-341` shows for `presentCall`.
 * One scenario per child process, because the fake reads one script at install time.
 *
 * Plane: `lib/` (the committed build output), never `src/`. `runInDistro` and `acceptRun`
 * are module-local and NOT exported from `lib/wsl-search.js`, which is why the drive goes
 * through the tool surface rather than the functions themselves.
 *
 * One fixture limitation, stated rather than hidden: `fake-child-process.mjs` builds its
 * error with `new Error(...)` and never sets `error.name`, so it cannot express the
 * `AbortError` Node hands a callback whose `options.signal` was already aborted.
 * Assertion 3 therefore layers a two-line translator over the armed fake that reproduces
 * the shape measured on this machine's Node 24.21.0
 * (`name:'AbortError', code:'ABORT_ERR', signal:undefined, killed:undefined`). The spawn is
 * still answered by the fake, so the call is still recorded and still must match.
 *
 *   node tests/search-run-fakes.mjs
 *
 * @module dsh-wsl-workspace/tests/search-run-fakes
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { RAW_OUTPUT_MAX_BYTES, SEARCH_TIMEOUT_MS } from '@deepseek-ai/dsh-tool-fs-search'

const NAME = 'SEARCH RUN FAKES'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fakeModule = pathToFileURL(join(repo, 'tests', 'support', 'fake-child-process.mjs')).href
/** The knobs the probe hands `apply()`, chosen small so overflow fixtures are cheap. */
const RAW_MAX = 100
const TIMEOUT_MS = 12345
const KILL_SLACK = 1_048_576

let failures = 0
let skips = 0
const assert = (condition, label) => {
  if (condition) {
    console.log(`ok: ${label}`)
    return
  }
  failures += 1
  console.error(`not ok: ${label}`)
}
const skip = (label, reason) => {
  skips += 1
  console.error(`SKIP: ${label} — platform cannot answer it here (${reason})`)
}

const work = mkdtempSync(join(tmpdir(), 'dsh-search-run-fakes-'))

/**
 * The probe every scenario runs. It arms nothing by itself: the fake is already installed
 * by `--import`, and importing its module for `fakeArmed()`/`fakeCalls()` deliberately does
 * not patch (that is the fixture's own positive control).
 */
const PROBE = `
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fakeArmed, fakeCalls } from ${JSON.stringify(fakeModule)}

// Assertion 3's translator: reproduce Node's pre-aborted-signal error shape over the
// answer the fake already gave, so the spawn is still recorded and still matched.
if (process.env.DSH_ABORT_TRANSLATE === '1') {
  const faked = childProcess.execFile
  childProcess.execFile = function patchedExecFile(file, args, options, callback) {
    if (typeof args === 'function') { callback = args; options = undefined; args = [] }
    if (typeof options === 'function') { callback = options; options = undefined }
    if (!(options && options.signal && options.signal.aborted)) {
      return faked.call(childProcess, file, args, options, callback)
    }
    return faked.call(childProcess, file, args, options, (error, stdout, stderr) => {
      // Measured on this machine (node 24.21.0): execFile whose options.signal is already
      // aborted hands the callback an error with name 'AbortError', code 'ABORT_ERR', and no
      // signal/killed marks. A DOMException cannot carry that code — its own code is a
      // read-only legacy number — so the shape is reproduced on a plain Error, which is what
      // Node itself throws here.
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      abortError.code = 'ABORT_ERR'
      callback(abortError, stdout, stderr)
    })
  }
  syncBuiltinESMExports()
}

const { apply } = await import(${JSON.stringify(pathToFileURL(join(repo, 'lib', 'wsl-search.js')).href)})
const config = process.env.DSH_PROBE_CONFIG === 'defaults' ? { distro: 'Ubuntu' } : {
  distro: 'Ubuntu',
  timeoutMs: ${TIMEOUT_MS},
  rawOutputMaxBytes: ${RAW_MAX},
  wslPath: 'wsl.exe',
}
const tools = new Map()
const ctx = {
  get: (key) => (key === 'tools' ? { register: (tool) => tools.set(tool.name, tool) } : undefined),
  effect: (fn) => { fn(); return () => {} },
}
apply(ctx, config)
const toolName = process.env.DSH_PROBE_TOOL === 'glob' ? 'glob' : 'grep'
const tool = tools.get(toolName)
const controller = new AbortController()
const preAborted = process.env.DSH_PROBE_PREABORT === '1'
if (preAborted) controller.abort()
const exec = {
  agent: { session: { header: { cwd: process.env.DSH_PROBE_CWD ?? '/home/m/ws' } } },
  signal: preAborted || process.env.DSH_PROBE_SIGNAL === '1' ? controller.signal : undefined,
}
const report = { toolName, armedBefore: false, callsBefore: [] }
report.armedBefore = fakeArmed()
let outcome = null
try {
  outcome = { kind: 'result', value: await tool.execute(
    toolName === 'grep' ? { pattern: 'TODO' } : { pattern: '**/*.ts' },
    exec,
  ) }
} catch (error) {
  outcome = {
    kind: 'thrown',
    name: String(error && error.name),
    code: String(error && error.code),
    message: String(error && error.message),
    isSearchError: String(error && error.name) === 'SearchError',
  }
}
report.armedAfter = fakeArmed()
report.outcome = outcome
// The probe lives in a temp dir, so a bare specifier would not resolve from there; the
// suite's own constants are compared in the parent, which does resolve them.
report.usedDefaults = process.env.DSH_PROBE_CONFIG === 'defaults'
report.configRawMax = ${RAW_MAX}
report.configTimeout = ${TIMEOUT_MS}
report.signalAborted = preAborted
report.calls = fakeCalls().map((call) => {
  const options = { ...(call.options ?? {}) }
  const hasSignal = Object.prototype.hasOwnProperty.call(options, 'signal')
  const signalIdentity = hasSignal && options.signal === exec.signal
  delete options.signal
  return {
    file: call.file,
    args: call.args,
    matched: call.matched,
    sync: call.sync === true,
    options,
    optionKeys: Object.keys(call.options ?? {}),
    hasSignal,
    signalIdentity,
  }
})
console.log('BPROBE:' + JSON.stringify(report))
`
const probePath = join(work, 'probe.mjs')
writeFileSync(probePath, PROBE, 'utf8')

/**
 * Run one scenario in its own process.
 * @param label - scenario name, for the failure message.
 * @param script - the fake's script object.
 * @param extraEnv - probe switches (signal, pre-abort, tool, config).
 * @returns the probe's report, or undefined when the probe could not answer.
 */
function runScenario(label, script, extraEnv = {}) {
  const scriptPath = join(work, `${label}.json`)
  writeFileSync(scriptPath, JSON.stringify(script, null, 2), 'utf8')
  const result = spawnSync(process.execPath, ['--import', fakeModule, probePath], {
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      DSH_FAKE_CHILD_PROCESS: scriptPath,
      DSH_PROBE_TOOL: undefined,
      DSH_PROBE_SIGNAL: undefined,
      DSH_PROBE_PREABORT: undefined,
      DSH_PROBE_CONFIG: undefined,
      DSH_ABORT_TRANSLATE: undefined,
      ...extraEnv,
    },
  })
  const line = (result.stdout ?? '').split('\n').find((candidate) => candidate.startsWith('BPROBE:'))
  if (line === undefined) {
    failures += 1
    console.error(`not ok: scenario "${label}" produced no report (exit ${result.status}): `
      + `${String(result.stderr ?? '').slice(-500)}`)
    return undefined
  }
  return JSON.parse(line.slice('BPROBE:'.length))
}

/** A scripted completed run: exit code, streams, optional kill marks. */
const run = (entry) => ({ calls: [{ match: { file: 'wsl.exe' }, ...entry }], default: 'error' })

try {
  // ── 1. the spawn contract ───────────────────────────────────────────────
  const plain = runScenario('contract', run({ code: 0, stdout: '', stderr: '' }))
  if (plain !== undefined) {
    const call = plain.calls?.[0]
    assert(plain.calls?.length === 1, `exactly one spawn per search (got ${plain.calls?.length})`)
    assert(call?.file === 'wsl.exe', `the spawn targets config.wslPath (got ${call?.file})`)
    assert(Array.isArray(call?.args) && call.args[0] === '-d' && call.args[1] === 'Ubuntu',
      `the argv selects the resolved distribution (got ${JSON.stringify(call?.args?.slice(0, 2))})`)
    assert(call?.sync !== true, 'the executor uses the async execFile, never execFileSync')
    assert(call?.options?.killSignal === 'SIGKILL',
      `the recorded options carry killSignal 'SIGKILL' (got ${JSON.stringify(call?.options?.killSignal)})`)
    assert(call?.options?.timeout === TIMEOUT_MS,
      `the recorded options carry the timeout the caller passed (${call?.options?.timeout})`)
    assert(call?.options?.encoding === 'buffer',
      `the recorded options ask for encoding 'buffer' (got ${JSON.stringify(call?.options?.encoding)})`)
    assert(call?.options?.windowsHide === true,
      `the recorded options carry windowsHide true (got ${JSON.stringify(call?.options?.windowsHide)})`)
    assert(call?.options?.maxBuffer === RAW_MAX + KILL_SLACK,
      `maxBuffer is rawOutputMaxBytes + 1_048_576 (${RAW_MAX} + ${KILL_SLACK} = ${RAW_MAX + KILL_SLACK}; `
        + `got ${call?.options?.maxBuffer})`)
    assert(call?.hasSignal === false && !(call?.optionKeys ?? []).includes('signal'),
      `no signal key is spread in when the caller passed none (keys ${JSON.stringify(call?.optionKeys)})`)
  }

  const withSignal = runScenario('contract-signal', run({ code: 0, stdout: '', stderr: '' }), { DSH_PROBE_SIGNAL: '1' })
  if (withSignal !== undefined) {
    const call = withSignal.calls?.[0]
    assert(call?.hasSignal === true, 'the signal key IS spread in when the caller passed one')
    assert(call?.signalIdentity === true,
      'the forwarded signal is the very AbortSignal the tool execution carried, not a copy')
  }

  const defaults = runScenario('contract-defaults', run({ code: 0, stdout: '', stderr: '' }), { DSH_PROBE_CONFIG: 'defaults' })
  if (defaults !== undefined) {
    const call = defaults.calls?.[0]
    assert(defaults.usedDefaults === true && defaults.configRawMax === RAW_MAX
      && defaults.configTimeout === TIMEOUT_MS,
      'the defaults scenario applied no rawOutputMaxBytes/timeoutMs of its own')
    assert(call?.options?.maxBuffer === RAW_OUTPUT_MAX_BYTES + KILL_SLACK,
      `with the shipped defaults, maxBuffer is RAW_OUTPUT_MAX_BYTES + 1_048_576 `
        + `(${RAW_OUTPUT_MAX_BYTES} + ${KILL_SLACK}; got ${call?.options?.maxBuffer})`)
    assert(call?.options?.timeout === SEARCH_TIMEOUT_MS,
      `with the shipped defaults, timeout is SEARCH_TIMEOUT_MS (${call?.options?.timeout})`)
    assert(call?.options?.killSignal === 'SIGKILL', 'the shipped defaults still ask for SIGKILL')
  }

  // ── 2. a killed run is SEARCH_ABORTED ───────────────────────────────────
  const killed = runScenario('killed', run({ code: null, signal: 'SIGKILL', killed: true, stderr: '' }))
  if (killed !== undefined) {
    assert(killed.outcome?.kind === 'thrown', 'a killed run throws rather than returning a result')
    assert(killed.outcome?.code === 'SEARCH_ABORTED',
      `a killed run surfaces SEARCH_ABORTED (got ${JSON.stringify(killed.outcome?.code)})`)
    assert(/cancelled or timed out before it finished/.test(String(killed.outcome?.message)),
      `its message matches /cancelled or timed out before it finished/ ("${String(killed.outcome?.message)}")`)
    assert(killed.outcome?.name === 'SearchError', 'the killed answer is a SearchError, host-suite vocabulary')
    assert(killed.calls?.[0]?.options?.timeout === TIMEOUT_MS && killed.calls?.[0]?.matched === true,
      'the killed scenario really did go through the faked spawn')
  }

  // ── 3. an already-aborted caller is SEARCH_ABORTED, not a spawn failure ─
  // runInDistro must NOT take the `code === null && !aborted && killSignal === null`
  // branch (`:849-852`) here: that branch REJECTS with a spawn error, and a user
  // pressing cancel would be reported as "wsl.exe could not start".
  const aborted = runScenario('preabort', run({ error: true, message: 'The operation was aborted' }),
    { DSH_PROBE_PREABORT: '1', DSH_ABORT_TRANSLATE: '1' })
  if (aborted !== undefined) {
    assert(aborted.signalAborted === true, 'the scenario premise holds: exec.signal was already aborted')
    assert(aborted.calls?.[0]?.hasSignal === true && aborted.calls?.[0]?.matched === true,
      'the aborted run still reached the faked spawn with the signal forwarded')
    assert(aborted.outcome?.kind === 'thrown', 'an aborted run throws rather than returning a result')
    assert(aborted.outcome?.code === 'SEARCH_ABORTED',
      `an already-aborted signal surfaces SEARCH_ABORTED (got ${JSON.stringify(aborted.outcome?.code)})`)
    assert(/cancelled or timed out before it finished/.test(String(aborted.outcome?.message)),
      'the aborted answer uses the same message as the killed answer')
    assert(aborted.outcome?.code !== 'ENOENT' && aborted.outcome?.name === 'SearchError',
      `the abort is NOT reported as a spawn failure (name ${aborted.outcome?.name}, code ${aborted.outcome?.code})`)
  }

  // ── 4. a process that never started REJECTS with ENOENT ─────────────────
  // The two domains are documented at `:812-814`: a spawn failure rejects, a completed
  // or killed run comes back for the caller to classify. Collapsing them would make
  // "wsl.exe is missing" look like "your search found nothing".
  const missing = runScenario('enoent', run({ code: 'ENOENT' }))
  if (missing !== undefined) {
    assert(missing.outcome?.kind === 'thrown', 'a process that never started throws')
    assert(missing.outcome?.code === 'ENOENT',
      `the rejection carries ENOENT itself (got ${JSON.stringify(missing.outcome?.code)})`)
    assert(missing.outcome?.name !== 'SearchError' && missing.outcome?.isSearchError === false,
      `it is NOT wrapped as a SearchError (name ${missing.outcome?.name})`)
    assert(missing.calls?.[0]?.matched === true && missing.calls?.[0]?.sync !== true,
      'the ENOENT came from the faked spawn, not from a real one')
  }

  // ── 5. exit 1 is a SUCCESS result for grep ──────────────────────────────
  const noMatch = runScenario('exit1', run({ code: 1, stdout: '', stderr: '' }))
  if (noMatch !== undefined) {
    assert(noMatch.outcome?.kind === 'result',
      `grep exiting 1 returns a result, it does not throw (outcome kind ${JSON.stringify(noMatch.outcome?.kind)})`)
    assert(Array.isArray(noMatch.outcome?.value?.matches) && noMatch.outcome.value.matches.length === 0,
      'the exiting-1 result is the honest empty match list')
  }
  // The two engines disagree on 1, and only grep gets the pass (`:883-884`, and the
  // comment at :863-865): glob/find exiting non-zero means it could not read the
  // target, which must not be reported as an empty directory.
  const globOne = runScenario('glob-exit1', run({ code: 1, stdout: '', stderr: '' }), { DSH_PROBE_TOOL: 'glob' })
  if (globOne !== undefined) {
    assert(globOne.outcome?.code === 'SEARCH_FAILED',
      `glob exiting 1 is still a failure, not a silent empty listing (got ${JSON.stringify(globOne.outcome?.code)})`)
  }

  // ── 6. stderr detail is the first line and <= 300 chars ─────────────────
  // A 900-byte multi-line stderr, whose FIRST line alone exceeds the cap, so both
  // truncations are observable rather than assumed.
  const firstLine = `grep: ${'A'.repeat(420)}`
  const secondLine = 'SECONDLINE-MUST-NEVER-REACH-THE-ANSWER'
  const thirdLine = 'B'.repeat(430)
  const noisyStderr = `${firstLine}\n${secondLine}\n${thirdLine}`
  assert(Buffer.byteLength(noisyStderr) > 850 && Buffer.byteLength(noisyStderr) <= 1000,
    `the stderr fixture is a real multi-line ~900-byte blob (${Buffer.byteLength(noisyStderr)} bytes, 3 lines)`)
  const expectedDetail = firstLine.slice(0, 300)

  const exit3 = runScenario('exit3', run({ code: 3, stdout: '', stderr: noisyStderr }))
  if (exit3 !== undefined) {
    const message = String(exit3.outcome?.message)
    const prefix = 'grep needs a GNU grep inside the distribution'
    const detail = message.startsWith(`${prefix} (`) && message.endsWith(')')
      ? message.slice(prefix.length + 2, -1)
      : message
    assert(exit3.outcome?.kind === 'thrown' && exit3.outcome?.code === 'SEARCH_FAILED',
      `exit 3 surfaces SEARCH_FAILED (got ${JSON.stringify(exit3.outcome?.code)})`)
    assert(detail === expectedDetail,
      `exit 3's detail is exactly the FIRST stderr line, cut at 300 chars (length ${detail.length})`)
    assert(!message.includes(secondLine) && !message.includes(thirdLine),
      'no later stderr line leaks into the detail')
    assert(detail.length === 300 && message.length <= prefix.length + 300 + 4,
      `the detail really is capped, not incidentally short (message ${message.length} chars)`)
  }

  const exit127 = runScenario('exit127', run({ code: 127, stdout: '', stderr: noisyStderr }))
  if (exit127 !== undefined) {
    const message = String(exit127.outcome?.message)
    const prefix = 'grep could not start its search command inside the distribution'
    const detail = message.startsWith(`${prefix}: `) ? message.slice(prefix.length + 2) : message
    assert(exit127.outcome?.kind === 'thrown' && exit127.outcome?.code === 'SEARCH_FAILED',
      `exit 127 surfaces SEARCH_FAILED (got ${JSON.stringify(exit127.outcome?.code)})`)
    assert(detail === expectedDetail,
      `exit 127's detail is exactly the FIRST stderr line, cut at 300 chars (length ${detail.length})`)
    assert(!message.includes(secondLine), 'no later stderr line leaks into the 127 detail')
  }

  // ── 7. raw-output overflow ──────────────────────────────────────────────
  const overflowStdout = 'x'.repeat(RAW_MAX + 1)
  const overflow = runScenario('overflow', run({ code: 0, stdout: overflowStdout, stderr: '' }))
  if (overflow !== undefined) {
    assert(overflow.outcome?.kind === 'thrown' && overflow.outcome?.code === 'SEARCH_RAW_OUTPUT_OVERFLOW',
      `one byte past the raw-output budget is SEARCH_RAW_OUTPUT_OVERFLOW `
        + `(got ${JSON.stringify(overflow.outcome?.code)})`)
    assert(String(overflow.outcome?.message).includes(String(RAW_MAX)),
      `the overflow message names the budget it blew ("${String(overflow.outcome?.message)}")`)
  }
  const atBudget = runScenario('at-budget', run({ code: 0, stdout: 'x'.repeat(RAW_MAX), stderr: '' }))
  if (atBudget !== undefined) {
    assert(atBudget.outcome?.kind === 'result',
      `exactly the budget is NOT an overflow (got ${JSON.stringify(atBudget.outcome?.code ?? 'result')})`)
  }

  // ── 8. the positive control: the fake answered, nothing real spawned ────
  const scenarios = [['contract', plain], ['contract-signal', withSignal], ['contract-defaults', defaults],
    ['killed', killed], ['preabort', aborted], ['enoent', missing], ['exit1', noMatch],
    ['glob-exit1', globOne], ['exit3', exit3], ['exit127', exit127], ['overflow', overflow],
    ['at-budget', atBudget]]
  for (const [label, report] of scenarios) {
    if (report === undefined) continue
    assert(report.armedAfter === true, `${label}: fakeArmed() was true once the probe ran (positive control)`)
    assert(report.armedBefore === false, `${label}: the probe armed nothing before the search ran`)
    assert((report.calls ?? []).length > 0, `${label}: the search really did spawn (through the fake)`)
    assert((report.calls ?? []).every((call) => call.matched === true),
      `${label}: every recorded call matched the script, so no real process was ever spawned`)
    assert((report.calls ?? []).every((call) => call.file === 'wsl.exe'),
      `${label}: the only spawn recorded is the scripted wsl.exe`)
  }

  // ── the promisify question the ticket asked about, measured not assumed ─
  // `src/host/wsl-search.ts:830` uses the CALLBACK form. If the executor used
  // `util.promisify(execFile)`, a plain wrapper (issue #35's shape) would hide the fake
  // and this file would pass on a silent no-op. The recorded calls above already prove
  // the callback form is reached; this pins the claim that the fake is visible to the
  // search executor at all under a plain `--import` install.
  if (plain !== undefined) {
    assert((plain.calls ?? []).length === 1 && plain.calls[0].matched === true && plain.armedAfter === true,
      'the fake is visible to the search executor through --import alone (no live distribution needed)')
  } else {
    skip('the fake visibility claim', 'the contract scenario had no report')
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log(failures === 0
  ? `${NAME} PASSED${skips > 0 ? ` (${skips} skipped — a skip is not a pass)` : ''}`
  : `${NAME} FAILED (${failures} failing)`)
process.exit(failures === 0 ? 0 : 1)
