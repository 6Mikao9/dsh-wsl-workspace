// Real-WSL regression for the persistent-shell relay: the process the host PTY
// backend spawns must hand a stateful WSL shell its stdio, start in the
// session's directory, and resolve the distribution from the cwd/env.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const relay = path.resolve(here, '../../src/host/wsl-relay.ts');
const node = process.execPath;
const distro = process.env.WSL_COMPAT_DISTRO || 'Ubuntu';
const workspace = process.env.WSL_COMPAT_RELAY_CWD || '\\\\wsl.localhost\\Ubuntu\\home\\mille\\symprobe\\ws';

/** Run the relay, feed it lines, and collect its output. */
async function drive(lines, options = {}) {
  const child = spawn(node, ['--experimental-strip-types', relay], {
    cwd: options.cwd ?? workspace,
    env: { ...process.env, ...options.env ?? {} },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  // Attach before feeding: a fast shell can exit while the writes are pending.
  const exited = new Promise(resolve => child.on('exit', (code) => resolve(code)))
  child.stdout.on('data', (chunk) => { out += chunk.toString() })
  child.stderr.on('data', (chunk) => { err += chunk.toString() })
  for (const line of lines) {
    await new Promise(resolve => setTimeout(resolve, 1200))
    child.stdin.write(`${line}\n`)
  }
  await new Promise(resolve => setTimeout(resolve, 1500))
  child.stdin.end()
  const code = await Promise.race([
    exited,
    new Promise(resolve => setTimeout(() => resolve('timeout'), 20_000)),
  ])
  if (code === 'timeout') {
    child.kill()
    throw new Error(`relay did not exit; output so far: ${out.slice(0, 300)} / ${err.slice(0, 300)}`)
  }
  return { out, err, code }
}

// 1. The shell starts in the session workspace, and state survives between
//    sends (each line is one model call).
const session = await drive(['pwd', 'export PERSIST_MARK=ok42; cd /tmp; pwd', 'echo MARK=$PERSIST_MARK; pwd', 'exit'])
assert.equal(session.code, 0, `relay exited ${session.code}; stderr=${session.err.slice(0, 300)}`)
assert.match(session.out, /\/home\/mille\/symprobe\/ws\n/, `pwd should start in the workspace: ${JSON.stringify(session.out.slice(0, 200))}`)
assert.match(session.out, /\/tmp\n/, `cd /tmp should print /tmp: ${JSON.stringify(session.out.slice(0, 200))}`)
assert.match(session.out, /MARK=ok42/, `state lost between sends: ${JSON.stringify(session.out.slice(0, 300))}`)
assert.equal((session.out.match(/\/tmp/g) ?? []).length >= 2, true, `cd /tmp should persist: ${JSON.stringify(session.out.slice(0, 300))}`)

// 2. The distribution resolves from DSH_WSL_DISTRO when the cwd does not name
//    one, and DSH_WSL_USER is honored (here: the same user, to prove the flag
//    reaches wsl.exe without changing the result).
const envSession = await drive(['echo distro=$WSL_DISTRO_NAME; whoami', 'exit'], {
  cwd: process.env.WSL_COMPAT_DRIVE_CWD || 'C:\\',
  env: { DSH_WSL_DISTRO: distro, DSH_WSL_USER: 'mille' },
})
assert.equal(envSession.code, 0, `relay exited ${envSession.code}; stderr=${envSession.err.slice(0, 300)}`)
assert.match(envSession.out, new RegExp(`distro=${distro}`), `DSH_WSL_DISTRO not honored: ${envSession.out.slice(0, 300)}`)
assert.match(envSession.out, /mille/, `DSH_WSL_USER not honored: ${envSession.out.slice(0, 300)}`)

console.log('PASS relay: stateful shell (export + cd persist between sends), starts in the session cwd,');
console.log('PASS relay: distro from the UNC cwd and from DSH_WSL_DISTRO, DSH_WSL_USER honored, clean exit');
