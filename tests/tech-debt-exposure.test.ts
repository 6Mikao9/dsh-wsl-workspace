/**
 * Tech-debt exposure: the four hazards named in the 2026-10-01 review pass, turned into tests,
 * plus the two boundary cases from that review's own list (interpreter metacharacters, and an
 * existing path past MAX_PATH) that the four numbered hazards do not reach.
 *
 * CONTRACT OF THIS FILE — read before triaging a red.
 *   Nothing here fixes product code. A red line is the reproduction, and the repair direction is
 *   written next to it. Do not weaken an assertion to make CI green, and do not "fix" it inside
 *   the test either. 绝对不要修改业务源代码：这些测试只负责让脆弱写法原形毕露。
 *
 * Every expectation below was measured on Win10 19045 + WSL 2.1.5 + node 24.21.0 before it was
 * written, and two suspects came out sound. The report predicted that `mklink /J` would crash on
 * spaced paths; it does not, because `shell:false` still goes through CreateProcess and Node
 * quotes argv entries containing spaces. The boundary list flagged long paths; a 300-character
 * existing path is read by `statSync` without help. Both are recorded as green contract lines
 * rather than quietly dropped — a suite is allowed to correct the person who wrote the ticket,
 * and a hand-quoted 'fix' for a non-bug would have regressed it.
 *
 *   node --test --experimental-strip-types tests/tech-debt-exposure.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodeWslOutput } from '../src/shared/wsl.ts'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const nul = String.fromCharCode(0)

/** A scratch root whose own name contains a space — the shape CI runners never have. */
function spacedScratch(prefix: string): string {
  const outer = mkdtempSync(join(tmpdir(), `${prefix} with space-`))
  mkdirSync(join(outer, 'sub dir'))
  return outer
}

// ─────────────────────────────────────────────────────────────────────────────
// 技术债 A —《npm.cmd 的逃逸》
// `scripts/verify-install.mjs:43-50` and `scripts/verify-artifact-identity.mjs:45-52` fall back
// to   spawnSync(program, args, { shell: process.platform === 'win32' })   when `npm_execpath`
// is absent, i.e. whenever a human runs the gate by hand. `shell:true` hands the argv to a command
// interpreter that RE-TOKENISES it: Node's own deprecation says the arguments "are not escaped,
// only concatenated" (DEP0190).
//
// Measured on this machine, same call shape, node.exe standing in for npm.cmd (identical quoting
// contract, no install, no network):
//   shell:true  → status 1, stderr `Error: Cannot find module 'D:\Temp\dsh-spaced'`
//   shell:false → status 0, child received exactly ["…\dsh-spaced probe-X\my package.tgz"]
// So the split is real, and it bites a *path-derived argument*: verify-install.mjs:68 passes the
// tarball path itself (`npm install <tarball>`), so a workspace under `C:\Users\John Doe\…` breaks
// the publish gate. Note the report's stated trigger was the working directory; measured, cwd with
// a space is fine — it is argv that the interpreter eats. The debt is the same, the mechanism is
// narrower and therefore fixable.
//
// Why nothing in the suite sees it: the maintainer machine and every GitHub runner path is
// space-free, and inside a lifecycle run `npm_execpath` IS set, so the shell branch is only taken
// by hand — a risky branch no test walks. That is the false-green class this file is about.
//
// REPAIR DIRECTION: delete the interpreter from the picture. Resolve npm's own entry script and run
// it on the interpreter we already know — `spawnSync(process.execPath, [npmCliJs, ...args])`, which
// lines :45-47 already do when `npm_execpath` points at a `.js`. A shell is only ever needed to
// LOOK UP a program by PATH name; when the code already holds an absolute path, the shell adds a
// quoting black box and nothing else.
// ─────────────────────────────────────────────────────────────────────────────
test('A: a spaced path handed to the shell fallback arrives as one argument', async () => {
  const work = spacedScratch('dsh-tde-npmcmd')
  try {
    const script = join(work, 'argv probe.js')
    writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))\n', 'utf8')
    const tarballLike = join(work, 'sub dir', 'my package.tgz')
    const warnings: string[] = []
    const onWarning = (warning: Error) => warnings.push(`${warning.name}: ${warning.message}`)
    process.on('warning', onWarning)
    const viaShell = spawnSync(process.execPath, [script, tarballLike], { shell: true, encoding: 'utf8' })
    const direct = spawnSync(process.execPath, [script, tarballLike], { shell: false, encoding: 'utf8' })
    await new Promise((settle) => setImmediate(settle))
    process.off('warning', onWarning)

    // Control first, so a red below can only mean the interpreter and never a broken fixture.
    assert.equal(direct.status, 0, `the shell-less control must succeed (${direct.stderr})`)
    assert.deepEqual(JSON.parse(String(direct.stdout).trim()), [tarballLike],
      'the shell-less control receives exactly one argument, intact')

    assert.equal(viaShell.status, 0,
      'an argv entry that contains a space must survive the interpreter the fallback uses — measured '
        + `today: status ${viaShell.status}, first stderr line `
        + `${JSON.stringify(String(viaShell.stderr ?? '').replace(/\r/g, '').split('\n')[0] ?? '')}, `
        + `and Node reported ${warnings.length > 0 ? warnings.join(' | ') : 'no DEP0190 (version-dependent)'}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 技术债 B —《空格路径处的 mklink 惨案》, ci/install-pinned.mjs:122-124.
//
// MEASURED, PREDICTION REFUTED: the report expected cmd.exe to split the spaced operands and
// mklink to fail. It does not fail.
//   cmd /c mklink /J "<dst with space>" "<src with space>"  → status 0, junction created,
//                                                            resolves as a directory
// `shell:false` still builds a CreateProcess command line, and Node quotes argv entries that
// contain whitespace, so mklink receives two operands, not four. The line below therefore asserts
// the WORKING contract: it is the guard against someone hand-quoting the operands on the strength
// of the report (Node would then double-quote and mklink really would fail).
//
// The debt that IS real, and red in the next test: `{ stdio: 'ignore' }` throws away the only
// explanation the child can give. Junction links fail for ordinary reasons on a real machine —
// destination exists, source missing, non-admin account without the privilege, an antivirus
// holding the path — and all the operator gets is `install-pinned: linking <src> -> <dst> failed`
// plus exit 1. Measured: the same failing call with stdio captured does carry cmd's own line.
// Same class as #44's "a red nobody can attribute".
//
// REPAIR DIRECTION: drop cmd.exe here entirely. `fs.symlinkSync(src, dst, 'junction')` is the
// node.exe equivalent (measured: same spaced paths, works), needs no shell, no quoting, and throws
// an Error carrying `EEXIST`/`EPERM`/`ENOENT` instead of a bare status number. If a real `mklink`
// semantic is ever required, capture stderr and print it.
// ─────────────────────────────────────────────────────────────────────────────
test('B: spaced operands DO reach mklink intact (the refuted prediction, pinned as a contract)', () => {
  const work = spacedScratch('dsh-tde-mklink')
  try {
    const srcDir = join(work, 'linked src')
    const dst = join(work, 'linked dst')
    mkdirSync(srcDir)
    if (isWin) {
      const linked = spawnSync('cmd', ['/c', 'mklink', '/J', dst, srcDir], { stdio: 'ignore', shell: false })
      assert.equal(linked.status, 0,
        `cmd /c mklink /J with spaced operands must succeed (measured status ${linked.status})`)
      assert.ok(existsSync(dst) && statSync(dst).isDirectory(), 'the junction resolves as a directory')
      // The trap this line exists to prevent: pre-quoting the operands on top of Node's own quoting
      // makes it four tokens to mklink. Assert the naive "fix" is not how this works.
      const preQuoted = spawnSync('cmd', ['/c', 'mklink', '/J', JSON.stringify(dst), JSON.stringify(srcDir)],
        { stdio: 'ignore', shell: false })
      assert.notEqual(preQuoted.status, 0,
        'hand-quoting already-quoted argv must NOT be the repair (it double-quotes); if this goes green, '
          + 'Node changed its argv quoting and the contract above needs re-measuring')
    } else {
      const linked = spawnSync('ln', ['-s', srcDir, dst], { stdio: 'ignore' })
      assert.equal(linked.status, 0, `ln -s with spaced operands must succeed (status ${linked.status})`)
      assert.ok(existsSync(dst), 'the link was created')
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('B: a failed link must be able to say why it failed', () => {
  const work = spacedScratch('dsh-tde-mklink-reason')
  try {
    const srcDir = join(work, 'linked src')
    const dst = join(work, 'linked dst')
    mkdirSync(srcDir)
    symlinkSync(srcDir, dst, isWin ? 'junction' : 'dir')
    const argv = isWin ? ['/c', 'mklink', '/J', dst, srcDir] : ['-s', srcDir, dst]
    const asWritten = spawnSync(isWin ? 'cmd' : 'ln', argv, { stdio: 'ignore' })
    assert.notEqual(asWritten.status, 0, 'the fixture must really fail the second link')
    // Read through `unknown` deliberately: with `stdio:'ignore'` Node's own types narrow
    // stdout/stderr to `null`, and that typing IS the measurement — the shape leaves no reason.
    const reason = String((asWritten as unknown as { stderr?: unknown }).stderr ?? '')
    assert.ok(reason.trim() !== '',
      'the reason the OS gave must survive to the caller; measured today: status '
        + `${asWritten.status}, stdout ${JSON.stringify((asWritten as unknown as { stdout?: unknown }).stdout)}, `
        + `stderr ${JSON.stringify((asWritten as unknown as { stderr?: unknown }).stderr)} — with `
        + 'stdio:"ignore" the child\'s own sentence is '
        + 'discarded, so install-pinned can only print the paths and exit 1')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 技术债 C —《UTF-16LE 幽灵注册表》, src/shared/wsl.ts:143-158 (`defaultDistro`).
// Both registry answers go through `textOf()` (`:66`), which is a hard `toString('utf8')`. This
// module OWNS an adaptive decoder (`decodeWslOutput`, `:97-102`) and does not use it here.
//
// Measured on this build, through the transport the product actually uses — a Node pipe,
// `encoding:'buffer'` — `reg.exe query …Lxss /v DefaultDistribution` answers **plain ASCII**
// (147 bytes, first 10 `0d 0a 48 4b 45 59 5f 43 55 52`, no NUL). So the UTF-16LE answer is NOT
// reachable here and this test is a conditional-transport reproduction, carrying the same tier
// label §6b in tests/search-run-fakes.mjs carries. It is still a defect and not a hypothesis:
// the encoding of a Windows console program's redirected output is a property of that program and
// that build, and on THIS machine `wsl.exe -l -q` answers UTF-16LE through the same kind of pipe
// (48 bytes, `55 00 62 00`). A build or locale where reg.exe does the same makes both regexes miss,
// no throw and no log happen, and `defaultDistro()` return `undefined` — which is how #44's empty
// distro picker presents.
//
// REPAIR DIRECTION: one decode policy for every captured stream in this module — pass
// `encoding:'buffer'` and call `decodeWslOutput(buffer)`. Read the D test below before doing it:
// the sniff needs a false-positive guard first, or adopting it here trades a silent `undefined`
// for a silent mojibake listing.
// ─────────────────────────────────────────────────────────────────────────────
test('C: a UTF-16LE registry answer still resolves the default distribution', () => {
  const work = mkdtempSync(join(tmpdir(), 'dsh-tde-registry-'))
  try {
    const guid = '{ce0fc2a6-29d7-467c-996a-eab37c96b876}'
    const distro = 'Ubuntu-24.04'
    const key = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'
    const first = `\r\n${key}\r\n    DefaultDistribution    REG_SZ    ${guid}\r\n\r\n`
    const second = `\r\n${key}\\${guid}\r\n    DistributionName    REG_SZ    ${distro}\r\n\r\n`
    // Two fixtures, one content: what this build really answers (plain ASCII through the pipe),
    // and the answer a different build or locale produces (UTF-16LE). The pair is what makes the
    // red below a transport finding rather than a broken-fixture finding.
    const utf8Path = join(work, 'script-ascii.json')
    const utf16Path = join(work, 'script-utf16.json')
    writeFileSync(utf8Path, JSON.stringify({
      calls: [
        { match: { file: 'reg.exe', argsContains: ['/v', 'DefaultDistribution'] }, code: 0,
          stdout: { text: first } },
        { match: { file: 'reg.exe', argsContains: ['/v', 'DistributionName'] }, code: 0,
          stdout: { text: second } },
      ],
      default: 'error',
    }), 'utf8')
    writeFileSync(utf16Path, JSON.stringify({
      calls: [
        { match: { file: 'reg.exe', argsContains: ['/v', 'DefaultDistribution'] }, code: 0,
          stdout: { utf16le: first } },
        { match: { file: 'reg.exe', argsContains: ['/v', 'DistributionName'] }, code: 0,
          stdout: { utf16le: second } },
      ],
      default: 'error',
    }), 'utf8')

    const probePath = join(work, 'probe.mjs')
    writeFileSync(probePath, `import { defaultDistro } from ${JSON.stringify(
      pathToFileURL(join(repo, 'src', 'shared', 'wsl.ts')).href)}
console.log('PROBE:' + JSON.stringify({ distro: (await defaultDistro()) ?? null }))
`, 'utf8')
    const fake = pathToFileURL(join(repo, 'tests', 'support', 'fake-child-process.mjs')).href
    const run = (scriptPath: string): { distro: string | null } => {
      const child = spawnSync(process.execPath,
        ['--experimental-strip-types', '--import', fake, probePath],
        { encoding: 'utf8', env: { ...process.env, DSH_FAKE_CHILD_PROCESS: scriptPath }, timeout: 60_000 })
      const line = String(child.stdout ?? '').split('\n').find((l) => l.startsWith('PROBE:'))
      if (line === undefined) {
        throw new Error(`probe produced no report (exit ${child.status}): `
          + `${String(child.stderr ?? '').slice(-500)}`)
      }
      return JSON.parse(line.slice('PROBE:'.length)) as { distro: string | null }
    }

    // The control: the transport this build really gives (plain ASCII through a pipe). It must
    // resolve, and it must keep resolving after any fix — that is what makes the red below a
    // transport finding rather than a broken fixture.
    const control = run(utf8Path)
    assert.equal(control.distro, distro,
      `the ASCII registry answer this build produces must resolve (got ${JSON.stringify(control.distro)})`)
    const utf16 = run(utf16Path)
    assert.equal(utf16.distro, distro,
      'a UTF-16LE registry answer must resolve the default distribution; today textOf() forces '
        + `utf8, both regexes miss, and the answer is ${JSON.stringify(utf16.distro)} with no throw `
        + 'and no log — an empty distro picker, indistinguishable from "WSL is not installed"')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 技术债 D —《带毒的 \0 UTF-8》, src/shared/wsl.ts:97-102.
// The entire adaptive decoder is one existential test: `buffer.includes(0) ? utf16le : utf8`.
// A NUL byte is not a UTF-16LE marker, it is a byte that is 0x00, and UTF-8 streams carry those
// legitimately — NUL-delimited listings are the NORMAL interface of `find -print0`, `grep -Z` and
// `git ls-files -z`, and this very plugin splits search stdout on '\0' at wsl-search.ts:320. Any
// such stream handed to this helper comes back as mojibake, silently and at double length.
//
// Reachability, stated honestly: no shipped route hands a NUL-bearing UTF-8 stream to
// decodeWslOutput today (the NUL-delimited paths read the buffer directly), so this is a latent
// defect in the helper — and it is load-bearing for the §6 repair, because the advice everywhere in
// this repo and in #44 is "route the call sites through decodeWslOutput". Doing that without
// fixing the sniff trades a garbled error message for a garbled listing.
//
// REPAIR DIRECTION: make the sniff structural instead of existential. A UTF-16LE console answer
// has its NULs at a regular parity and cadence (for ASCII text, every odd byte, and a `ff fe` BOM
// when the writer emits one), so test WHERE the NULs are and what proportion they are, not merely
// THAT they are; and give the helper an explicit-encoding path so a caller that knows its stream is
// NUL-delimited never goes through a heuristic at all.
// ─────────────────────────────────────────────────────────────────────────────
test('D: a NUL inside a UTF-8 stream does not flip the decode to UTF-16LE', () => {
  const message = `Error${nul}: invalid path`
  const utf8 = Buffer.from(message, 'utf8')
  // Fixture premise, asserted: these bytes are valid UTF-8 that merely contains a NUL.
  assert.equal(utf8.includes(0), true, 'the fixture contains a NUL byte')
  assert.equal(utf8.toString('utf8'), message, 'the fixture round-trips as UTF-8')

  const decoded = decodeWslOutput(utf8)
  assert.equal(decoded, message,
    'decodeWslOutput must not read a NUL-bearing UTF-8 stream as UTF-16LE — measured today: '
      + `${JSON.stringify(decoded)} (${decoded.length} characters from ${utf8.length} bytes), `
      + 'because the whole policy is `buffer.includes(0)`')

  // The same shape at the size a real answer arrives: a NUL-delimited listing.
  const listingText = `/home/me/a${nul}/home/me/b${nul}`
  const listing = Buffer.from(listingText, 'utf8')
  assert.equal(decodeWslOutput(listing), listingText,
    'a find -print0 / grep -Z style listing must survive the heuristic')

  // And the converse half of the same policy, so the repair cannot be "just always use utf8":
  // a genuine UTF-16LE answer must still decode. That is what today's heuristic gets right.
  const realUtf16 = Buffer.from(listingText, 'utf16le')
  assert.equal(decodeWslOutput(realUtf16), listingText,
    'a real UTF-16LE stream must decode — the guard must stay structural, not become a constant')
})

// ─────────────────────────────────────────────────────────────────────────────
// 技术债 E —《被吞掉的 &，被重定向的 >》: the same fallback as A, but the failure is SILENT.
// A measured a path with a space, which at least exits non-zero. These two do not:
//
//   `%DSH_PROBE_UNSET%literal&tail`  shell:false → received verbatim
//                                    shell:true  → the child gets `%DSH_PROBE_UNSET%literal`
//                                    with status 0: `&tail` vanished and cmd parsed the rest
//   `a^b>c`                          shell:false → verbatim
//                                    shell:true  → the child gets NOTHING (empty argv), status
//                                    0, and cmd used `>c` as a REDIRECTION, writing a file
//                                    named c into the working directory
//
// That is the review's third principle as a failing test: a value the caller treats as data can
// lose its tail without an error, or reach the interpreter as a control character and create
// files. No gate downstream would notice — `npm install <path>` resolving a different path, or a
// publish step writing into the tree, both look like success.
//
// REPAIR DIRECTION: as A — no shell on any argv path (`process.execPath` plus the CLI's own
// .js). Where a `.cmd` launcher genuinely must run, hand it one fixed string with no
// caller-derived content in it, and treat an argument containing & | > < ^ % as a defect report
// rather than as input. `spawn-through-a-shell-with-args` in the scanner lists the sites.
// ─────────────────────────────────────────────────────────────────────────────
test('E: an argument handed to the shell fallback keeps its metacharacters and writes nothing', () => {
  // No space in this scratch root on purpose: the space case is A's, and mixing them would make
  // a red here ambiguous about which behaviour broke.
  const work = mkdtempSync(join(tmpdir(), 'dsh-tde-pct-'))
  try {
    const script = join(work, 'argv.js')
    writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))\n', 'utf8')
    const ampersand = '%DSH_PROBE_UNSET%literal&tail'
    const redirect = 'a^b>c'
    const stray = join(work, 'c')
    const argvOf = (result: ReturnType<typeof spawnSync>) => {
      try {
        return JSON.parse(String(result.stdout).trim()) as string[]
      } catch {
        return []
      }
    }
    const throughShell = (value: string) =>
      spawnSync(process.execPath, [script, value], { shell: true, encoding: 'utf8', cwd: work })
    const directly = (value: string) =>
      spawnSync(process.execPath, [script, value], { shell: false, encoding: 'utf8', cwd: work })

    // Controls first: without an interpreter both values are data and nothing is written.
    assert.deepEqual(argvOf(directly(ampersand)), [ampersand],
      'the shell-less control must receive the ampersand value verbatim')
    assert.deepEqual(argvOf(directly(redirect)), [redirect],
      'the shell-less control must receive the caret/redirect value verbatim')
    assert.equal(existsSync(stray), false, 'the shell-less control must not write a file')

    const amp = throughShell(ampersand)
    assert.deepEqual(argvOf(amp), [ampersand],
      'a value containing & must reach the program intact — measured today: status '
        + `${amp.status} (no error!) and the child received ${JSON.stringify(argvOf(amp))}, so `
        + 'cmd ate the tail of the argument and parsed the remainder as a command')
    const red = throughShell(redirect)
    assert.deepEqual(argvOf(red), [redirect],
      'a value containing ^ and > must reach the program intact — measured today: status '
        + `${red.status}, child argv ${JSON.stringify(argvOf(red))}`)
    assert.equal(existsSync(stray), false,
      `a value containing > must not be able to create a file in the working directory `
        + `(measured today: ${JSON.stringify(stray)} exists = ${existsSync(stray)})`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 边界探测 —《极长路径》, measured rather than assumed.
// A path built past 300 characters — well over the 260 MAX_PATH line — is still readable by
// statSync on this machine, so `check` sees it and answers honestly today. This line is GREEN on
// purpose: it is the tier declaration, and it is the assertion that flips if the volume ever
// loses long-path transparency. At that point the review's `exists:false` fold becomes reachable
// from an ordinary deep working tree, and this becomes the red the product round needs.
// ─────────────────────────────────────────────────────────────────────────────
test('boundary: an existing path past the 260-character line is still seen as existing', () => {
  const work = mkdtempSync(join(tmpdir(), 'dsh-tde-longpath-'))
  try {
    let cursor = work
    for (let depth = 0; depth < 40 && cursor.length <= 300; depth += 1) {
      cursor = join(cursor, 'segment-directory-name')
      mkdirSync(cursor)
    }
    assert.ok(cursor.length > 260, `the fixture is past MAX_PATH (${cursor.length} characters)`)
    const leaf = join(cursor, 'leaf.txt')
    writeFileSync(leaf, 'x', 'utf8')
    assert.equal(existsSync(leaf), true, 'the deep file exists as far as the OS is concerned')
    assert.doesNotThrow(() => statSync(leaf),
      `statSync must read a ${cursor.length}-character path — measured today it does; if this `
        + 'goes red, src/index.ts:319-325 is reachable from an ordinary deep tree')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
