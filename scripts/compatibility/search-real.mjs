// Isolated real-distribution regression for the WSL search tools: the `grep` and
// `glob` twins run inside the distribution on GNU grep/find, and the whole
// model-facing contract (framing, caps, footers, cards) is exercised here against
// a fixture no user directory is asked to provide.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { apply } from '../../src/host/wsl-search.ts';

const execFileAsync = promisify(execFile);
const distro = process.env.WSL_COMPAT_DISTRO || 'Ubuntu';
const linux = process.env.WSL_COMPAT_ROOT || '/tmp/dsh-wsl-compat';
/** The `\\wsl.localhost\<distro>\…` spelling of a Linux path. */
const uncOf = value => `\\\\wsl.localhost\\${distro}${value.replaceAll('/', '\\')}`;
/** Run one command inside the distribution (symlinks and mtimes are Linux-side). */
const wsl = (...args) => execFileAsync('wsl.exe', ['-d', distro, '--', ...args], {timeout: 30_000});

await wsl('mkdir', '-p', linux);
const root = (await wsl('mktemp', '-d', '-p', linux, 'search-XXXXXX')).stdout.trim();
const outside = (await wsl('mktemp', '-d', '-p', linux, 'search-outside-XXXXXX')).stdout.trim();
const uncRoot = uncOf(root);

/** Write one fixture file under an explicit UNC base, creating its directory. */
async function fileAt(base, relative, content) {
  const target = path.join(base, relative);
  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.writeFile(target, content);
  return target;
}

/** Write one fixture file under the fixture root. */
const file = (relative, content) => fileAt(uncRoot, relative, content)

const BASE_CONFIG = {
  grepMaxMatches: 250,
  grepMaxLineBytes: 2000,
  globMaxResults: 100,
  sampleOverCapGlobResults: false,
  searchMetaMaxBytes: 65536,
  rawOutputMaxBytes: 20_000_000,
  timeoutMs: 30_000,
  wslPath: 'wsl.exe',
};

/**
 * Register the tools the way the loader would and hand back a driver bound to
 * the fixture workspace.
 * @param config - the plugin config under test.
 * @param options - an optional formatted-result spill backend to fake.
 * @returns the two tools, a caller and the collected warnings.
 */
function makeTools(config = {}, options = {}) {
  const registry = new Map();
  const warnings = [];
  apply({
    get: name => name === 'tools'
      ? {register: tool => registry.set(tool.name, tool)}
      : name === 'spillStore' ? options.spillStore : undefined,
    logger: {warn: message => warnings.push(message)},
  }, {...BASE_CONFIG, ...config});
  const call = (tool, args, exec = {}) => tool.execute(args, {
    name: tool.name,
    agent: {session: {header: {cwd: uncRoot, id: 'search-real'}}},
    ...exec,
  });
  return {
    grep: registry.get('grep'),
    glob: registry.get('glob'),
    names: [...registry.keys()],
    warnings,
    call,
    text: (tool, args, value) => tool.output.render(args, value).map(part => part.text).join('\n'),
    meta: (tool, args, value) => tool.output.presentationMeta(args, value),
    card: (tool, args, value) => tool.presentResult(args, {meta: tool.output.presentationMeta(args, value)}),
  };
}

const tools = makeTools();
const {grep, glob} = tools;

try {
  assert.deepEqual(tools.names, ['grep', 'glob']);

  // ── fixture ────────────────────────────────────────────────────────────────
  await file('project/.git/config', 'needle in VCS metadata');
  await file('project/src/alpha.txt', 'first line\nneedle with: a colon\nlast line\n');
  await file('project/src/beta.txt', 'NEEDLE upper case\nneedle two\n');
  await file('project/src/spaced name.txt', 'needle in a spaced file\n');
  await file('project/src/unicode.txt', 'needle \u00fcn\u00efcode \u4e2d\u6587\n');
  await file('project/src/.env', 'needle secret\n');
  await file('project/notes.md', 'needle in markdown\n');
  await file('project/src/long.txt', `needle ${'x'.repeat(4000)}\n`);
  await file('project/src/many.txt', `${Array.from({length: 300}, (_, index) => `needle ${index + 1}`).join('\n')}\n`);
  await file('project/node_modules/pkg/ignored.txt', 'needle in a dependency\n');
  await file('project/.hidden/ignored.txt', 'needle in a hidden directory\n');
  await fileAt(uncOf(outside), 'outside-src/linked.txt', 'needle through an explicit link\n');
  await wsl('ln', '-s', `${outside}/outside-src`, `${root}/project/linked-src`);

  // ── grep: what the model sees ──────────────────────────────────────────────
  const found = await tools.call(grep, {pattern: 'needle'});
  const paths = [...new Set(found.matches.map(match => match.path))].sort();
  assert.deepEqual(paths, [
    'project/notes.md',
    'project/src/alpha.txt',
    'project/src/beta.txt',
    'project/src/long.txt',
    'project/src/many.txt',
    'project/src/spaced name.txt',
    'project/src/unicode.txt',
  ], 'grep searches the workspace and skips hidden files/dirs, node_modules, VCS and in-tree symlinks');
  const colon = found.matches.find(match => match.path === 'project/src/alpha.txt');
  assert.equal(colon.lineNumber, 2, 'line numbers are 1-based');
  assert.equal(colon.line, 'needle with: a colon', 'a colon in the line survives the NUL framing');
  assert.equal(found.matches.find(match => match.path === 'project/src/unicode.txt').line, 'needle \u00fcn\u00efcode \u4e2d\u6587');
  assert.equal((await tools.call(grep, {pattern: 'needle', path: 'project/src/beta.txt'})).matches.length, 1);
  const includeFiltered = await tools.call(grep, {pattern: 'needle', include: 'alpha.*'});
  assert.equal(includeFiltered.matches.length, 1, `include filter kept ${JSON.stringify(includeFiltered.matches.slice(0, 5))}`);
  const braceFiltered = await tools.call(grep, {pattern: 'needle', include: '*.{txt,md}'});
  assert.deepEqual([...new Set(braceFiltered.matches.map(match => match.path))].sort(), [
    'project/notes.md',
    'project/src/alpha.txt',
    'project/src/beta.txt',
    'project/src/long.txt',
    'project/src/many.txt',
    'project/src/spaced name.txt',
    'project/src/unicode.txt',
  ], 'a braced include expands to one --include per alternative');
  const pathFiltered = await tools.call(grep, {pattern: 'needle', include: 'project/src/alpha.*'});
  assert.deepEqual(pathFiltered.matches.map(match => match.path), ['project/src/alpha.txt'],
    'a path-shaped include is matched against the path relative to the search root');
  assert.equal((await tools.call(grep, {pattern: 'needle', path: 'project/linked-src'})).matches.length, 1,
    'a link named as the search target is followed, like rg');
  await assert.rejects(tools.call(grep, {pattern: 'needle', path: '/nope-missing'}), error => error.code === 'SEARCH_FAILED');

  // A shell-metacharacter pattern is a regex, never a command: the argv vector
  // reaches bash as positional parameters, so nothing is interpolated.
  await tools.call(grep, {pattern: '`touch /tmp/dsh-wsl-search-pwned`'});
  await wsl('test', '!', '-e', '/tmp/dsh-wsl-search-pwned');

  // ── grep: caps, footers, cards and errors ──────────────────────────────────
  const narrowArgs = {pattern: 'needle', include: 'alpha.txt'};
  const rendered = tools.text(grep, narrowArgs, await tools.call(grep, narrowArgs));
  assert.equal(rendered.includes('Line 2: needle with: a colon'), true, rendered);
  const longArgs = {pattern: 'needle', include: 'long.txt'};
  const longRendered = tools.text(grep, longArgs, await tools.call(grep, longArgs));
  const longLine = longRendered.split('\n').find(line => line.startsWith('Line 1: needle xxx'));
  assert.equal(longLine.endsWith('(line truncated)'), true, 'an over-long line is previewed with a marker');
  // The marker is additive (the host suite's own `previewLine`), so the preview
  // BODY is what the byte cap bounds.
  const preview = longLine.replace(/^Line \d+: /, '').replace(' (line truncated)', '');
  assert.equal(Buffer.byteLength(preview, 'utf8') <= 2000, true);

  const cappedMeta = tools.meta(grep, {pattern: 'needle'}, found);
  assert.equal(cappedMeta.shape, 'matches');
  assert.equal(cappedMeta.truncated, true, '300 matches exceed the 250 inline cap');
  assert.equal(cappedMeta.total, found.matches.length);
  const cappedText = tools.text(grep, {pattern: 'needle'}, found);
  assert.equal(cappedText.startsWith(`Found 250 of ${found.matches.length} matches`), true, cappedText.slice(0, 40));
  assert.equal(cappedText.includes('The complete result could not be saved'), true);
  assert.equal(tools.warnings.some(message => /result not saved/.test(message)), true,
    'a capped result reports the missing spill backend instead of failing');
  // With a spill backend the capped result is recoverable, exactly as on the host.
  const spilled = makeTools({}, {
    spillStore: {saveText: async save => ({locator: `spill://probe/${save.suggestedName}`, retrievalHint: 'Read it with the read tool.'})},
  });
  const spilledValue = await spilled.call(spilled.grep, {pattern: 'needle'});
  assert.equal(spilledValue.spill.locator, 'spill://probe/grep-results.txt');
  assert.equal(spilled.text(spilled.grep, {pattern: 'needle'}, spilledValue)
    .includes('Full grep result stored at: spill://probe/grep-results.txt'), true);
  assert.deepEqual(spilled.warnings, []);
  const narrowCard = tools.card(grep, narrowArgs, await tools.call(grep, narrowArgs));
  assert.deepEqual(narrowCard, {
    card: 'search',
    shape: 'matches',
    files: [{path: 'project/src/alpha.txt', matches: [{lineNumber: 2, line: 'needle with: a colon'}]}],
    truncated: false,
    total: 1,
  }, 'the completed call projects a search card from its metadata');
  assert.equal(tools.card(grep, {pattern: 'needle'}, found).truncated, true);
  assert.equal(tools.text(grep, {pattern: 'nothing-matches-this'}, await tools.call(grep, {pattern: 'nothing-matches-this'})), 'No matches found');

  await assert.rejects(tools.call(grep, {pattern: '(unclosed'}), error => error.code === 'SEARCH_INVALID_PATTERN');
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(tools.call(grep, {pattern: 'needle'}, {signal: abort.signal}), error => error.code === 'SEARCH_ABORTED');
  await assert.rejects(tools.call(grep, {pattern: 'x', include: '*.ts,!*.js'}), /negation|list|include/i);

  // ── glob: listing, order, caps ─────────────────────────────────────────────
  // Distinct modification times: ripgrep's `--sort=modified` is oldest first.
  await wsl('touch', '-d', '4 hours ago', `${root}/project/src/beta.txt`);
  await wsl('touch', '-d', '3 hours ago', `${root}/project/src/alpha.txt`);
  await wsl('touch', '-d', '2 hours ago', `${root}/project/src/spaced name.txt`);
  const listing = await tools.call(glob, {pattern: '**/*.txt'});
  assert.equal(listing.root, '.');
  assert.deepEqual(listing.paths, [
    'project/src/beta.txt',
    'project/src/alpha.txt',
    'project/src/spaced name.txt',
    'project/src/unicode.txt',
    'project/src/long.txt',
    'project/src/many.txt',
    'project/node_modules/pkg/ignored.txt',
    'project/.hidden/ignored.txt',
  ], 'hidden and ignored files are listed (like rg --no-ignore --hidden), VCS metadata and in-tree symlinks are not');
  assert.equal(tools.text(glob, {pattern: '**/*.txt'}, listing), listing.paths.join('\n'));

  const basename = await tools.call(glob, {pattern: '*.txt', path: 'project/src'});
  assert.equal(basename.root, 'project/src');
  assert.equal(basename.paths.length, 6);
  assert.equal(basename.paths.every(value => value.startsWith('project/src/')), true);
  const outsideWorkdir = await tools.call(glob, {pattern: '*.txt', path: outside});
  assert.equal(outsideWorkdir.root.startsWith('/'), true, 'a root outside the workdir is absolute');
  assert.deepEqual(outsideWorkdir.paths, [`${outside}/outside-src/linked.txt`]);
  assert.equal(tools.text(glob, {pattern: '**/*.txt'}, {root: '.', paths: []}), 'No files found');
  assert.equal(tools.card(glob, {pattern: '**/*.txt'}, listing).shape, 'paths');

  const small = makeTools({globMaxResults: 3});
  const smallPage = await small.call(small.glob, {pattern: '**/*.txt'});
  const smallText = small.text(small.glob, {pattern: '**/*.txt'}, smallPage);
  assert.equal(smallText.endsWith('(Showing 3 of 8 paths. The complete result could not be saved; narrow pattern or path to see more.)'), true, smallText);
  assert.equal(small.card(small.glob, {pattern: '**/*.txt'}, smallPage).truncated, true);
  assert.equal(small.card(small.glob, {pattern: '**/*.txt'}, smallPage).total, 8);

  // ── the defects a later pass found, each one regression-pinned ─────────────
  // A file the caller names explicitly is what it asked for: the hidden-file
  // guard must not silently drop it.
  await file('project/src/.env', 'needle in an explicitly named dot-file\n');
  assert.deepEqual(
    (await tools.call(grep, {pattern: 'needle', path: 'project/src/.env'})).matches.map(match => match.path),
    ['project/src/.env'],
    'a dot-file named as the target is searched',
  );
  assert.equal(
    (await tools.call(grep, {pattern: 'needle'})).matches.some(match => match.path === 'project/src/.env'),
    false,
    'a directory search still skips dot-files',
  );

  // `find` reports a target it cannot read through its exit status; that must not
  // look like an empty directory.
  await assert.rejects(tools.call(glob, {pattern: '*', path: '/nope-missing'}), error => error.code === 'SEARCH_FAILED');
  await assert.rejects(tools.call(glob, {pattern: '*', path: '/nope-missing'}), /No such file or directory/);
  // A file target is a legitimate one-entry listing.
  assert.deepEqual((await tools.call(glob, {pattern: '*.txt', path: 'project/src/beta.txt'})).paths, ['project/src/beta.txt']);

  // A search root whose own name contains a newline must survive the header.
  // The directory is made by a script file rather than an argv element: a newline
  // inside a `wsl.exe` argument is treated as a command separator, so it cannot
  // travel that way (the plugin's own argv carries no newlines either).
  const oddDir = `${linux}/odd\nname-dir`;
  const script = `${linux}/make-odd.sh`;
  await fileAt(uncOf(linux), 'make-odd.sh', [
    '#!/bin/sh',
    `mkdir -p '${oddDir}'`,
    `printf 'needle inside an odd directory name\\n' > '${oddDir}/inner.txt'`,
    '',
  ].join('\n'));
  try {
    await wsl('sh', script);
    const oddGlob = await tools.call(glob, {pattern: '**/*.txt', path: oddDir});
    assert.equal(oddGlob.root, oddDir, 'the resolved root survives a newline in its name');
    assert.deepEqual(oddGlob.paths, [`${oddDir}/inner.txt`]);
    assert.deepEqual(
      (await tools.call(grep, {pattern: 'needle', path: oddDir})).matches.map(match => match.path),
      [`${oddDir}/inner.txt`],
    );
  } finally {
    // The directory's own name cannot ride a `wsl.exe` argv (a newline separates
    // commands there), so the cleanup script is written for it.
    await fileAt(uncOf(linux), 'clean-odd.sh', `#!/bin/sh\nrm -rf '${oddDir}' '${script}'\n`);
    await wsl('sh', `${linux}/clean-odd.sh`);
  }

  // A Windows drive path means the same tree the file tools open, via /mnt.
  const drive = process.env.WSL_COMPAT_DRIVE_PATH ?? 'D:\\ProgramData\\dsh-wsl-workspace\\tests';
  const viaDrive = await tools.call(glob, {pattern: '*.ts', path: drive});
  assert.equal(viaDrive.paths.some(path => path.endsWith('wsl-search.test.ts')), true,
    `a Windows path searches its /mnt form: ${JSON.stringify(viaDrive.paths.slice(0, 3))}`);

  // A cooperative timeout is an abort, not a provider failure.
  const impatient = makeTools({timeoutMs: 1});
  await assert.rejects(impatient.call(impatient.grep, {pattern: 'needle'}), error => error.code === 'SEARCH_ABORTED');

  // Raw-output overflow: the in-distro cap is honoured and reported as such.
  const tight = makeTools({rawOutputMaxBytes: 120});
  await assert.rejects(tight.call(tight.grep, {pattern: 'needle'}), error => error.code === 'SEARCH_RAW_OUTPUT_OVERFLOW');

  console.log('PASS real distribution: grep framing/caps/errors, glob listing/order/caps, argv never shell-parsed');
  console.log('PASS real distribution: explicit dot-file targets, unreadable roots, odd root names, /mnt paths, abort + overflow');
} finally {
  for (const candidate of [root, outside]) {
    if (path.dirname(candidate) !== linux) throw new Error(`Unexpected fixture root: ${candidate}`);
  }
  try {
    await wsl('rm', '-rf', root, outside);
  } catch (error) {
    console.error(`search-real: fixture cleanup failed (${error.message})`);
  }
}
