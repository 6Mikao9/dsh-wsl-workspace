// Isolated real-9P regression; no pre-existing user fixture is removed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WslSkillsProvider, nodeSkillIo } from '../../src/host/wsl-skills.ts';

const execFileAsync = promisify(execFile);
const distro = process.env.WSL_COMPAT_DISTRO || 'Ubuntu';
const linux = process.env.WSL_COMPAT_ROOT || '/tmp/dsh-wsl-compat';
const parent = `\\\\wsl.localhost\\${distro}${linux.replaceAll('/', '\\')}`;
/** The Linux path of a `\\wsl.localhost\<distro>\…` spelling. */
const linuxOf = unc => `/${unc.replace(/^\\\\wsl\.localhost\\[^\\]+\\/, '').replaceAll('\\', '/')}`;
/** The `\\wsl.localhost\<distro>\…` spelling of a Linux path. */
const uncOf = value => `\\\\wsl.localhost\\${distro}${value.replaceAll('/', '\\')}`;
/** Run one command inside the distribution (symlinks cannot be made from Windows). */
const wsl = (...args) => execFileAsync('wsl.exe', ['-d', distro, '--', ...args], {timeout: 30_000});
// Both fixtures are created BY the distribution: a directory the Windows side
// has just made can still be missing from the share's view for a moment, and
// `ln -s` inside it then fails.
await wsl('mkdir', '-p', linux);
const root = uncOf((await wsl('mktemp', '-d', '-p', linux, 'skills-XXXXXX')).stdout.trim());
// The second fixture sits OUTSIDE the scan root: the only way in is a Linux
// symlink, which this share lists but cannot follow. The distribution resolves it.
const outside = uncOf((await wsl('mktemp', '-d', '-p', linux, 'outside-XXXXXX')).stdout.trim());
const control = new AbortController();
const provider = new WslSkillsProvider({signal: control.signal, invalidate() {}});
async function skillAt(base, relative, name, body) {
  const file = path.join(base, relative);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `\uFEFF---\r\nname: ${name}\r\ndescription: Compatibility fixture\r\n---\r\n${body}`);
  return file;
}
const skill = (relative, name, body) => skillAt(root, relative, name, body);
try {
  await skill('.agents/skills/root-check/SKILL.md', 'root-check', 'Root body');
  const nestedFile = await skill('project/.dsh/skills/nested-check/SKILL.md', 'nested-check', 'First character survives');
  await skill('node_modules/trap/.agents/skills/ignored/SKILL.md', 'ignored', 'Never visible');
  await fs.mkdir(path.join(root, 'project/.git'), {recursive: true});
  await fs.mkdir(path.join(root, 'project/src'), {recursive: true});
  // A project linked in from outside the workspace, a nested project below the
  // link target, a link to a file, a dangling link and a loop back into the
  // workspace root: only the two project links may add skills.
  await skillAt(outside, 'linked/.dsh/skills/linked-check/SKILL.md', 'linked-check', 'Reached through a symlink');
  await skillAt(outside, 'linked/nested/.agents/skills/deep-check/SKILL.md', 'deep-check', 'Below a linked project');
  await fs.writeFile(path.join(root, 'notes.md'), 'notes');
  await wsl('ln', '-s', `${linuxOf(outside)}/linked`, `${linuxOf(root)}/linked-project`);
  await wsl('ln', '-s', `${linuxOf(root)}/notes.md`, `${linuxOf(root)}/notes-link`);
  await wsl('ln', '-s', `${linuxOf(parent)}/never-created`, `${linuxOf(root)}/broken-link`);
  await wsl('ln', '-s', linuxOf(root), `${linuxOf(root)}/loop`);

  const all = await provider.list({cwd: root});
  assert.deepEqual(all.map(x => x.name).sort(), ['deep-check', 'linked-check', 'nested-check', 'root-check']);
  const linked = all.find(x => x.name === 'linked-check');
  assert.ok(linked.locator.path.includes('outside-'), `linked skill must be served at its real path: ${linked.locator.path}`);
  assert.equal((await provider.get(linked, {cwd: root})).content, 'Reached through a symlink');
  assert.equal((await provider.get(all.find(x => x.name === 'deep-check'), {cwd: root})).content, 'Below a linked project');
  // Without the distribution fallback the same walk cannot see either link.
  const bare = new WslSkillsProvider({signal: control.signal, invalidate() {}}, {
    readdir: nodeSkillIo.readdir, readFile: nodeSkillIo.readFile, stat: nodeSkillIo.stat,
  });
  assert.deepEqual((await bare.list({cwd: root})).map(x => x.name).sort(), ['nested-check', 'root-check']);
  const nested = await provider.list({cwd: path.join(root, 'project/src')});
  assert.deepEqual(nested.map(x => x.name), ['nested-check']);
  assert.equal((await provider.get(nested[0], {cwd: root})).content, 'First character survives');
  await fs.writeFile(nestedFile, '---\nname: nested-check\ndescription: Changed\n---\nUpdated body');
  assert.equal((await provider.get(nested[0], {cwd: root})).content, 'Updated body');
  assert.deepEqual(await provider.list({cwd: process.cwd()}), []);

  // The mid-session detector must notice an EDIT to an existing skill file — the
  // case no directory listing can see — using the 9P share's real modification
  // times, and it must do so on the cheap pass (the discovery walk is parked out
  // of reach here).
  const watched = new AbortController();
  let invalidations = 0;
  const watcher = new WslSkillsProvider(
    {signal: watched.signal, invalidate() { invalidations += 1; }},
    nodeSkillIo,
    Date.now,
    200,
    1_000_000,
  );
  try {
    const published = await watcher.list({cwd: root});
    const target = published.find(x => x.name === 'nested-check');
    assert.ok(target !== undefined, 'the watcher publishes the fixture catalog');
    await fs.writeFile(target.locator.path, '---\nname: nested-check\ndescription: Edited description\n---\nEdited body');
    const deadline = Date.now() + 5_000;
    while (invalidations === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(invalidations, 1, 'an edited skill file invalidates exactly once');
    // Unchanged content must not keep invalidating the registry.
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(invalidations, 1, 'a stable catalog stays quiet');
  } finally {
    watched.abort();
  }
  console.log('PASS real 9P: nested discovery, nearest Git root, pruning, BOM/CRLF/body, live get, Windows exclusion');
  console.log('PASS real 9P: linked-in project + nested project resolved through wsl.exe readlink, file/dangling/loop links ignored');
  console.log('PASS real 9P: an edited skill file invalidates the catalog through the share\u2019s own modification times');
} finally {
  control.abort();
  // Both roots come only from `mktemp -d` above, under the explicit fixture
  // parent. Remove them from inside the distribution: a Windows-side recursive
  // delete would have to walk the links this test just made.
  for (const candidate of [root, outside]) {
    if (path.dirname(path.resolve(candidate)) !== path.resolve(parent)) throw new Error('Unexpected fixture root');
  }
  try {
    await wsl('rm', '-rf', linuxOf(root), linuxOf(outside));
  } catch (error) {
    console.error(`skills-real: fixture cleanup failed (${error.message})`);
  }
}
