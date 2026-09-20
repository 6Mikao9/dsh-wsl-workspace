// Real-9P regression for the WSL filesystem backend: Linux symlinks resolve
// through the distribution, writes are fenced by the file policy, and the two
// compose (a link out of the workspace is an outside write).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Context } from '@deepseek-ai/cordis';
import { WslFileSystem } from '../../src/fs.ts';
import { joinUnc } from '../../src/shared/paths.ts';

const execFileAsync = promisify(execFile);
const distro = process.env.WSL_COMPAT_DISTRO || 'Ubuntu';
const home = (await execFileAsync('wsl.exe', ['-d', distro, '--', 'printenv', 'HOME'], {timeout: 30_000})).stdout.trim();
// NOT under /tmp: the policy allows the platform temp area by design, and a
// fixture there could not tell "fenced" from "inside the temp allowance".
const parent = `\\\\wsl.localhost\\${distro}${home.replaceAll('/', '\\')}`;
const linuxOf = unc => `/${unc.replace(/^\\\\wsl\.localhost\\[^\\]+\\/, '').replaceAll('\\', '/')}`;
const uncOf = value => `\\\\wsl.localhost\\${distro}${value.replaceAll('/', '\\')}`;
const wsl = (...args) => execFileAsync('wsl.exe', ['-d', distro, '--', ...args], {timeout: 30_000});

/** The backend with an injected policy, so no host service is needed. */
class PolicyFileSystem extends WslFileSystem {
  constructor(ctx, cwd, policy) {
    super(ctx, {cwd, diffBasisMaxBytes: 1024 * 1024});
    this.policy = policy;
  }
  sandboxPolicy() {
    return this.policy;
  }
}

const codeOf = async promise => {
  try { await promise; return 'resolved'; } catch (error) { return String(error?.code ?? error?.message); }
};

await wsl('mkdir', '-p', home);
const rootLinux = (await wsl('mktemp', '-d', '-p', home, '.dsh-wsl-fs-XXXXXX')).stdout.trim();
const root = uncOf(rootLinux);
const wsLinux = `${rootLinux}/ws`;
const outsideLinux = `${rootLinux}/outside`;
const ws = uncOf(wsLinux);
const outside = uncOf(outsideLinux);
const file = new PolicyFileSystem(new Context(), ws, {mode: 'workspace-write', workspaceRoot: ws});

try {
  await wsl('mkdir', '-p', `${wsLinux}/sub`, `${outsideLinux}/dir`);
  await fs.writeFile(`${outside}\\real.txt`, 'outside body\n');
  await fs.writeFile(`${outside}\\dir\\nested.txt`, 'nested body\n');
  await fs.writeFile(`${ws}\\inside.txt`, 'inside body\n');
  await wsl('ln', '-s', `${outsideLinux}/real.txt`, `${wsLinux}/link-file`);
  await wsl('ln', '-s', `${outsideLinux}/dir`, `${wsLinux}/link-dir`);
  await wsl('ln', '-s', `${wsLinux}/new-from-link.txt`, `${wsLinux}/link-dangling`);
  await wsl('ln', '-s', `${rootLinux}/never-created.txt`, `${wsLinux}/link-out-dangling`);
  await wsl('ln', '-s', `${wsLinux}/inside.txt`, `${wsLinux}/link-inside`);
  await wsl('ln', '-s', `${wsLinux}/link-file`, `${wsLinux}/link-chain`);

  // 1. A link resolves to its real target, so reads work through it.
  const linked = await file.resolve(`${ws}\\link-file`);
  assert.equal(linked.displayPath, `${outsideLinux}/real.txt`, `display path: ${linked.displayPath}`);
  assert.equal(String(linked.targetKey).toLowerCase(), `${outside}\\real.txt`.toLowerCase(), `target key: ${linked.targetKey}`);
  assert.equal(await file.readText(linked), 'outside body\n');
  assert.equal(await file.readText(await file.resolve(`${ws}\\link-chain`)), 'outside body\n');
  assert.equal(await file.readText(await file.resolve(`${ws}\\link-dir\\nested.txt`)), 'nested body\n');
  assert.ok(await file.lstat(`${ws}\\link-file`) !== undefined, 'lstat must describe a link target');

  // 2. Writing through a dangling link creates the target and keeps the link.
  const dangling = await file.resolve(`${ws}\\link-dangling`);
  assert.equal(dangling.displayPath, `${wsLinux}/new-from-link.txt`);
  await file.writeText(dangling, 'created through the link\n');
  assert.equal((await wsl('cat', `${wsLinux}/new-from-link.txt`)).stdout, 'created through the link\n');
  assert.equal((await wsl('readlink', `${wsLinux}/link-dangling`)).stdout.trim(), `${wsLinux}/new-from-link.txt`);
  // ... and a dangling link whose target is OUTSIDE the workspace is denied,
  // because the policy fences the resolved target, not the link.
  assert.equal(
    await codeOf(file.writeText(await file.resolve(`${ws}\\link-out-dangling`), 'escape\n')),
    'FS_SANDBOX_DENIED',
  );

  // 3. A link inside the workspace writes through to its inside target.
  const inside = await file.resolve(`${ws}\\link-inside`);
  await file.writeText(inside, 'rewritten\n');
  assert.equal(await fs.readFile(`${ws}\\inside.txt`, 'utf8'), 'rewritten\n');
  assert.equal((await wsl('readlink', `${wsLinux}/link-inside`)).stdout.trim(), `${wsLinux}/inside.txt`);

  // 4. The policy sees the REAL path: a link out of the workspace is denied.
  assert.equal(await codeOf(file.writeText(linked, 'escape\n')), 'FS_SANDBOX_DENIED');
  assert.equal(await fs.readFile(`${outside}\\real.txt`, 'utf8'), 'outside body\n');

  // 5. The distribution's own /tmp is writable (the WSL analogue of the
  //    platform temp allowance); a drive path outside the workspace is not.
  await file.writeText(await file.resolve(joinUnc(distro, '/tmp/dsh-wsl-fs-real.txt')), 'temp\n');
  assert.equal((await wsl('cat', '/tmp/dsh-wsl-fs-real.txt')).stdout, 'temp\n');
  assert.equal(await codeOf(file.writeText(await file.resolve(`${outside}\\escape.txt`), 'no\n')), 'FS_SANDBOX_DENIED');

  console.log('PASS real 9P fs: link -> real path, read/write through links, dangling-link create, link preserved,');
  console.log('PASS real 9P fs: policy fences the resolved target (outside link denied), distro /tmp allowed');
} finally {
  await wsl('rm', '-f', '/tmp/dsh-wsl-fs-real.txt').catch(() => {});
  if (path.dirname(path.resolve(root)) !== path.resolve(parent)) throw new Error('Unexpected fixture root');
  await wsl('rm', '-rf', rootLinux).catch(error => console.error(`fs-real: cleanup failed (${error.message})`));
}
