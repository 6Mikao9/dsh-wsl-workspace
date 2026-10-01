/**
 * The deliberate-red ledger — the single machine-readable record of which assertions this repo
 * ships RED on purpose, and on which machine shape each one is red.
 *
 * WHY A LEDGER INSTEAD OF "CI IS ALLOWED TO BE RED"
 *   #46 carries reproductions of issue #44 §6 and of the four tech-debt hazards. They must stay red
 *   to be evidence, but a permanently red frame disarms the one arbiter this project agreed on
 *   (cloud checks green = accepted). So the gate moved from "did the suites pass" to "is the set of
 *   reds exactly the declared set":
 *     - a NEW red (not declared here)          -> run-seams fails  (a real regression is visible)
 *     - a declared red that turned GREEN       -> run-seams fails  (someone fixed the product and
 *                                                    owes this file an edit; the debt cannot be
 *                                                    silently retired, and neither can its proof)
 *     - a red that moved to a shape not declared, or became a skip -> fails too
 *   The assertions themselves are untouched by this: every red still runs and still prints its full
 *   failure text. Only the aggregate verdict changed, and it changed toward stricter, not laxer.
 *
 * `prefix` is matched as a substring of the suite's own `not ok:` / `✖` line, with the node:test
 * duration suffix removed. Keep prefixes long enough to be unique inside their suite.
 */

/** @typedef {'red'|'skip'} Observed */
export const SHAPES = ['win32', 'posix']

/**
 * @type {{id: string, suite: string, prefix: string, skipPrefix?: string, issue: string,
 *   expect: Record<string, Observed>, debt: string, repair: string}[]}
 */
export const DELIBERATE_REDS = [
  {
    id: 'fold-unreadable-path',
    suite: 'route-envelope (§6 exists:false fold)',
    prefix: 'an unreadable existing path is NOT answered as {exists:false}',
    skipPrefix: 'an unreadable existing path is not reported as absent',
    issue: '#44 (exists:false fold)',
    expect: { win32: 'red', posix: 'skip' },
    debt: 'src/index.ts folds a read it never performed into {exists:false}: a directory nobody can '
      + 'read is reported as not existing.',
    repair: 'answer {ok:false} with the OS error when the stat itself fails; keep {exists:false} for '
      + 'ENOENT only.',
  },
  {
    id: 'detail-nul-laced',
    suite: 'search-run-fakes (§6 transport seams)',
    prefix: 'utf16le: the detail carries no NUL',
    issue: '#44 §6',
    expect: { win32: 'red', posix: 'red' },
    debt: 'src/host/wsl-search.ts decodes every stderr with toString(\'utf8\'); wsl.exe writes '
      + 'UTF-16LE, so half of the 300-character detail budget is spent on NULs.',
    repair: 'decode captured streams with the shared shape-aware decoder, then truncate on '
      + 'characters the reader can actually see.',
  },
  {
    id: 'detail-budget',
    suite: 'search-run-fakes (§6 transport seams)',
    prefix: 'utf16le: the detail is the first stderr line cut AT 300 significant characters',
    issue: '#44 §6',
    expect: { win32: 'red', posix: 'red' },
    debt: 'same call site: the truncation counts bytes-decoded-as-characters, so a UTF-16LE stderr '
      + 'reaches the operator as 150 readable characters.',
    repair: 'same repair — cut after decoding, not before.',
  },
  {
    id: 'invalid-pattern-never-fires',
    suite: 'search-run-fakes (§6 transport seams)',
    prefix: 'utf16le exit 2 classifies the SAME invalid pattern',
    issue: '#44 §6',
    expect: { win32: 'red', posix: 'red' },
    debt: 'INVALID_PATTERN.test(run.stderr) can never match text with a NUL between every letter, so '
      + 'a real "invalid pattern" answer is classified as a generic search failure.',
    repair: 'test the classifier against decoded text.',
  },
  {
    id: 'reason-dropped-with-stream',
    suite: 'search-run-fakes (§6 transport seams)',
    prefix: 'the reason wsl.exe gave must reach the user',
    issue: '#44 §6',
    expect: { win32: 'red', posix: 'red' },
    debt: 'a launch failure\'s own sentence (which distribution is missing) is dropped together with '
      + 'the stream it arrived on.',
    repair: 'carry the first decoded line into the outcome message.',
  },
  {
    id: 'shell-spaced-argv',
    suite: 'tech-debt-exposure (cmd.exe fallback, registry decode, NUL sniff)',
    prefix: 'A: a spaced path handed to the shell fallback arrives as one argument',
    issue: 'review pass 2026-10-01, hazard A',
    expect: { win32: 'red', posix: 'red' },
    debt: 'scripts/verify-install.mjs and scripts/verify-artifact-identity.mjs fall back to '
      + 'spawnSync(program, args, { shell: … }), and the shell re-tokenises the tarball path.',
    repair: 'spawnSync(process.execPath, [npmCliJs, ...args]) — the branch the code already takes '
      + 'when npm_execpath points at a .js.',
  },
  {
    id: 'link-failure-silent',
    suite: 'tech-debt-exposure (cmd.exe fallback, registry decode, NUL sniff)',
    prefix: 'B: a failed link must be able to say why it failed',
    issue: 'review pass 2026-10-01, hazard B (refuted half)',
    expect: { win32: 'red', posix: 'red' },
    debt: '{ stdio: \'ignore\' } discards the linker\'s own sentence, so a failing link leaves the '
      + 'operator a bare exit number. The spaced-path crash this test replaced was refuted by '
      + 'measurement and is pinned green elsewhere in the same file.',
    repair: 'fs.symlinkSync(src, dst, \'junction\') — throws an Error carrying EEXIST/EPERM.',
  },
  {
    id: 'registry-utf16le',
    suite: 'tech-debt-exposure (cmd.exe fallback, registry decode, NUL sniff)',
    prefix: 'C: a UTF-16LE registry answer still resolves the default distribution',
    issue: 'review pass 2026-10-01, hazard C',
    expect: { win32: 'red', posix: 'red' },
    debt: 'defaultDistro parses textOf(stdout) (a hard toString(\'utf8\')) while the same module owns '
      + 'the shape-aware decoder; a UTF-16LE answer silently yields undefined — an empty picker, no '
      + 'throw, no log.',
    repair: 'one decode policy for every captured stream, fed by encoding:\'buffer\'.',
  },
  {
    id: 'nul-sniff-false-positive',
    suite: 'tech-debt-exposure (cmd.exe fallback, registry decode, NUL sniff)',
    prefix: 'D: a NUL inside a UTF-8 stream does not flip the decode to UTF-16LE',
    issue: 'review pass 2026-10-01, hazard D',
    expect: { win32: 'red', posix: 'red' },
    debt: 'the adaptive decoder is buffer.includes(0) ? utf16le : utf8, so legitimate NUL-delimited '
      + 'output (find -print0, grep -Z, git ls-files -z) comes back garbled.',
    repair: 'make the sniff structural (NUL parity and proportion, BOM) and keep an explicit-encoding '
      + 'path — this constrains the §6 repair too.',
  },
  {
    id: 'shell-metacharacters',
    suite: 'tech-debt-exposure (cmd.exe fallback, registry decode, NUL sniff)',
    prefix: 'E: an argument handed to the shell fallback keeps its metacharacters and writes nothing',
    issue: 'review boundary list, metacharacter case',
    expect: { win32: 'red', posix: 'red' },
    debt: 'the same shell fallback ends an argument at & and parses the remainder as a command, and '
      + 'lets > open a file in the caller\'s working directory — both with a success status.',
    repair: 'same as hazard A: no interpreter in the path.',
  },
]

/** Strip the runner's own decorations so a ledger prefix can match the name. */
export function normalise(line) {
  return String(line ?? '')
    .replace(/^not ok:\s*/, '')
    .replace(/^✖\s*/, '')
    .replace(/\s*\(\d+(?:\.\d+)?ms\)\s*$/, '')
    .trim()
}

/**
 * Turn raw suite output into the unique names the ledger compares.
 *
 * node:test prints every failing name twice (in the list and again under a bare
 * `✖ failing tests:` header), and that header names no assertion — keeping it would make the gate
 * report an undeclared red on every run of the .ts suite, which is noise about the runner, not about
 * the product.
 *
 * @param {Iterable<string>} lines
 * @returns {{red: string[], skip: string[]}}
 */
export function collectObserved(lines) {
  const red = []
  const skip = []
  const seenRed = new Set()
  const seenSkip = new Set()
  for (const raw of lines) {
    const line = String(raw ?? '').trim()
    const isRed = line.startsWith('not ok:') || line.startsWith('✖ ')
    const isSkip = line.startsWith('SKIP:')
    if (!isRed && !isSkip) continue
    const name = normalise(line)
    if (name === '' || name === 'failing tests:') continue
    if (isRed) {
      if (seenRed.has(name)) continue
      seenRed.add(name)
      red.push(name)
    } else {
      if (seenSkip.has(name)) continue
      seenSkip.add(name)
      skip.push(name)
    }
  }
  return { red, skip }
}

/**
 * Compare what the suites actually produced with what this file declares.
 *
 * @param {string} shape - 'win32' or 'posix'.
 * @param {{red: string[], skip: string[]}} observed - normalised names, already deduplicated.
 * @param {typeof DELIBERATE_REDS} [ledger]
 * @returns {{ok: boolean, shape: string, declared: number, observedRed: number, missing: string[],
 *   extraRed: string[], extraSkip: string[], moved: string[]}}
 */
export function compareLedger(shape, observed, ledger = DELIBERATE_REDS) {
  if (!SHAPES.includes(shape)) throw new Error(`compareLedger: unknown shape ${JSON.stringify(shape)}`)
  const reds = observed.red ?? []
  const skips = observed.skip ?? []
  const missing = []
  const moved = []
  const claimed = new Set()
  const verdicts = []
  for (const entry of ledger) {
    const want = entry.expect[shape]
    if (want === undefined) throw new Error(`ledger entry ${entry.id} declares no expectation for shape ${shape}`)
    const hit = reds.findIndex(name => name.includes(entry.prefix))
    if (hit >= 0) claimed.add(hit)
    if (want === 'red' && hit < 0) {
      // Was it answered as a skip instead? That is a moved premise, not a fixed product.
      const skipHit = entry.skipPrefix !== undefined
        && skips.some(name => name.includes(entry.skipPrefix))
      if (skipHit) moved.push(`${entry.id} (declared red on ${shape}, observed as skip)`)
      else missing.push(`${entry.id} — ${entry.prefix}`)
      verdicts.push(`${entry.id}:${skipHit ? 'moved' : 'MISSING'}≠red`)
      continue
    }
    if (want === 'skip') {
      if (hit >= 0) {
        moved.push(`${entry.id} (declared skip on ${shape}, observed red)`)
        verdicts.push('moved≠skip')
      } else if (!skips.some(name => name.includes(entry.skipPrefix ?? entry.prefix))) {
        missing.push(`${entry.id} — the skip line itself disappeared (premise no longer stated)`)
        verdicts.push('MISSING-skip')
      } else verdicts.push('skip')
      continue
    }
    verdicts.push('red')
  }
  const extraRed = reds.filter((_, index) => !claimed.has(index))
  const declaredSkipPrefixes = ledger.map(e => e.skipPrefix).filter(p => p !== undefined)
  const extraSkip = skips.filter(name => !declaredSkipPrefixes.some(p => name.includes(p)))
  return {
    ok: missing.length === 0 && extraRed.length === 0 && moved.length === 0,
    shape,
    declared: ledger.length,
    observedRed: reds.length,
    missing,
    extraRed,
    extraSkip,
    moved,
  }
}
