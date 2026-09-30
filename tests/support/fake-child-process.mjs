// A faked `node:child_process` for tests that must prove behaviour on the spawn/kill/timeout
// branches, which are otherwise reachable only against a live distribution.
//
// Mechanism is the one tests/exec-shape.mjs already proves: patch the CommonJS exports of
// `node:child_process`, then call `syncBuiltinESMExports()` so ESM named imports see the
// replacement. Installed with `--import`, so it is armed before the subject module is loaded.
//
// The fake reports whether it was reached (the probe under test must observe `armed`), which
// is what stops a passing run from being a no-op — the same positive control exec-shape uses.
//
//   node --experimental-strip-types --import ./tests/support/fake-child-process.mjs <probe>
//   DSH_FAKE_CHILD_PROCESS=/path/to/script.json
//
// script.json:
//   {
//     "calls": [
//       { "match": { "file": "wsl.exe", "argsContains": ["-l"] },
//         "code": 0, "stdout": "...", "stderr": "", "encoding": "buffer" },
//       { "match": { "file": "wsl.exe" }, "passthrough": true },
//       { "match": {}, "code": null, "signal": "SIGKILL", "killed": true, "stderr": "..." }
//     ],
//     "default": "error"          // "error" (default) | "passthrough"
//   }
//
// `stdout`/`stderr` may be a string (written with the requested encoding) or
// { "utf16le": "text" } / { "base64": "..." } for an exact byte stream.
import childProcess from 'node:child_process'
import { readFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

const SCRIPT_PATH = process.env.DSH_FAKE_CHILD_PROCESS
const calls = []

/** Every call the fake answered, in order, with the options object it received. */
export function fakeCalls() {
  return calls
}

/** True once the fake has answered at least one call — the positive control. */
export function fakeArmed() {
  return calls.length > 0
}

const originalExecFile = childProcess.execFile
const originalExecFileSync = childProcess.execFileSync

let script = { calls: [], default: 'error' }
if (SCRIPT_PATH !== undefined && SCRIPT_PATH !== '') {
  script = JSON.parse(readFileSync(SCRIPT_PATH, 'utf8'))
}

/** Turn a scripted payload into the Buffer or string the caller asked for. */
function encodePayload(payload, options) {
  const asText = typeof payload === 'string' ? payload : payload?.text ?? ''
  if (payload !== null && typeof payload === 'object' && payload.utf16le !== undefined) {
    const buffer = Buffer.from(payload.utf16le, 'utf16le')
    return options?.encoding === 'buffer' ? buffer : buffer.toString('utf8')
  }
  if (payload !== null && typeof payload === 'object' && payload.base64 !== undefined) {
    const buffer = Buffer.from(payload.base64, 'base64')
    return options?.encoding === 'buffer' ? buffer : buffer.toString('utf8')
  }
  return options?.encoding === 'buffer' ? Buffer.from(asText, options?.encodingOf ?? 'utf8') : asText
}

/** The first scripted entry whose match is contained in the observed call. */
function select(file, args) {
  for (const entry of script.calls ?? []) {
    const match = entry.match ?? {}
    if (match.file !== undefined && match.file !== file) continue
    const want = match.argsContains ?? []
    if (want.some(arg => !(args ?? []).includes(arg))) continue
    return entry
  }
  return undefined
}

function buildError(entry, file) {
  const error = new Error(entry?.message ?? `spawn ${file} ENOENT`)
  // A killed run has code === null, which must not be copied onto the error: the distinction
  // between "exited with a code" and "was signalled" is the thing the subject branches on.
  if (entry?.code !== undefined && entry?.code !== null) error.code = entry.code
  if (entry?.killed === true || entry?.signal !== undefined) {
    error.killed = entry.killed ?? true
    error.signal = entry.signal ?? 'SIGKILL'
  }
  return error
}

function fakeExecFile(file, args, options, callback) {
  if (typeof args === 'function') {
    callback = args
    options = undefined
    args = []
  }
  if (typeof options === 'function') {
    callback = options
    options = undefined
  }
  args = Array.isArray(args) ? args : args === undefined ? [] : [args]
  const entry = select(file, args)
  calls.push({ file, args, options, matched: entry !== undefined })

  if (entry === undefined && script.default === 'passthrough') {
    return originalExecFile.call(childProcess, file, args, options ?? {}, callback)
  }
  if (entry !== undefined && entry.passthrough === true) {
    return originalExecFile.call(childProcess, file, args, options ?? {}, callback)
  }
  if (entry === undefined) {
    // An unmatched call is a fixture gap, not a silent real spawn: the point of the fake is
    // that nothing here reaches a real wsl.exe.
    const error = new Error(`fake-child-process: no scripted answer for ${file} ${args.join(' ')}`)
    error.code = 'FAKE_UNMATCHED'
    callback(error, '', '')
    return
  }
  const stdout = encodePayload(entry.stdout, options)
  const stderr = encodePayload(entry.stderr, options)
  // `code: 1` is a real answer, not a success: GNU grep exits 1 for "no matches" and the
  // subject branches on exactly that. Pass the exit code through the way Node does.
  const isFailure = entry.error === true
    || entry.error === undefined && (entry.code === undefined || entry.code !== 0)
    || typeof entry.error === 'number' && entry.error !== 0
  if (isFailure) {
    const error = buildError(entry, file)
    if (typeof entry.error === 'number') error.code = entry.error
    callback(error, stdout, stderr)
    return
  }
  callback(null, stdout, stderr)
}

function fakeExecFileSync(file, args, options) {
  calls.push({ file, args: args ?? [], options, sync: true, matched: false })
  const error = new Error(`fake-child-process: execFileSync(${file}) is not scripted; use execFile`)
  error.code = 'FAKE_UNMATCHED'
  throw error
}

// Installing is an explicit action, never a module-load side effect. The probe under test
// imports this file to read fakeArmed()/fakeCalls(); if importing it also patched
// child_process, then `armed` would be true in the very run that is supposed to prove the
// wrapper never ran, and the positive control would be a decoration.
export function installFakeChildProcess() {
  childProcess.execFile = fakeExecFile
  childProcess.execFileSync = fakeExecFileSync
  // Without this the ESM named bindings keep pointing at the originals and the fake silently
  // never runs — which is exactly the false green this file exists to avoid.
  syncBuiltinESMExports()
  return true
}

// The wrapper entry point: `--import` loads this file with DSH_FAKE_CHILD_PROCESS set, which
// is the only configuration under which the patch is installed automatically.
if (SCRIPT_PATH !== undefined && SCRIPT_PATH !== '') {
  installFakeChildProcess()
}

if (process.env.DSH_FAKE_CHILD_PROCESS_REPORT === '1') {
  process.on('exit', () => {
    process._rawDebug('fake-child-process calls: ' + JSON.stringify(calls))
  })
}
