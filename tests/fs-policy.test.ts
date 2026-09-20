/**
 * Unit tests for the WSL filesystem's two host-parity seams: the file-effect
 * policy fence on writes, and the Linux symlink fallback in `resolve`.
 *
 * The fence is exercised against real Windows paths (a drive path travels
 * through `translate` untouched), with the policy injected through the
 * protected `sandboxPolicy` seam, so these run without a live distro. The
 * symlink half needs the real 9P share and lives in
 * `scripts/compatibility/fs-real.mjs`.
 *
 * Run with `node --test tests/fs-policy.test.ts`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { WslFileSystem, type SandboxPolicyLike } from '../src/fs.ts'

/** The provider with an injected policy, so no host service is needed. */
class PolicyFileSystem extends WslFileSystem {
  policy: SandboxPolicyLike | undefined

  protected override sandboxPolicy(): SandboxPolicyLike | undefined {
    return this.policy
  }

  constructor(ctx: Context, cwd: string, policy: SandboxPolicyLike | undefined) {
    super(ctx, { cwd, diffBasisMaxBytes: 1024 * 1024 })
    this.policy = policy
  }
}

/**
 * A workspace plus a sibling directory that is inside NO writable root: the
 * fixture is created under the process cwd, because the policy also allows the
 * platform temp area (`os.tmpdir()`), and a `mkdtemp` fixture would therefore
 * be writable by design.
 */
async function workspace(): Promise<{ root: string; outside: string; cleanup: () => Promise<void> }> {
  const base = await mkdtemp(join(process.cwd(), '.fs-policy-'))
  const root = join(base, 'workspace')
  const outside = join(base, 'outside')
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
  return { root, outside, cleanup: () => rm(base, { recursive: true, force: true }) }
}

/** The error code a rejection carries, or a marker when it did not reject. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'resolved'
  } catch (error) {
    return String((error as { code?: unknown }).code ?? (error as Error).message)
  }
}

test('workspace-write allows a write inside the workspace', async () => {
  const { root, cleanup } = await workspace()
  try {
    const fs = new PolicyFileSystem(new Context(), root, { mode: 'workspace-write', workspaceRoot: root })
    const target = await fs.resolve(join(root, 'notes.txt'))
    await fs.writeText(target, 'inside\n')
    assert.equal(await readFile(join(root, 'notes.txt'), 'utf8'), 'inside\n')
  } finally {
    await cleanup()
  }
})

test('workspace-write denies a write outside the workspace', async () => {
  const { root, outside, cleanup } = await workspace()
  try {
    const fs = new PolicyFileSystem(new Context(), root, { mode: 'workspace-write', workspaceRoot: root })
    const target = await fs.resolve(join(outside, 'escape.txt'))
    assert.equal(await codeOf(fs.writeText(target, 'nope\n')), 'FS_SANDBOX_DENIED')
  } finally {
    await cleanup()
  }
})

test('read-only denies writes inside the workspace too', async () => {
  const { root, cleanup } = await workspace()
  try {
    const fs = new PolicyFileSystem(new Context(), root, { mode: 'read-only', workspaceRoot: root })
    const target = await fs.resolve(join(root, 'notes.txt'))
    assert.equal(await codeOf(fs.writeText(target, 'nope\n')), 'FS_SANDBOX_DENIED')
  } finally {
    await cleanup()
  }
})

test('danger-full-access allows a write outside the workspace', async () => {
  const { root, outside, cleanup } = await workspace()
  try {
    const fs = new PolicyFileSystem(new Context(), root, { mode: 'danger-full-access', workspaceRoot: root })
    const target = await fs.resolve(join(outside, 'allowed.txt'))
    await fs.writeText(target, 'outside\n')
    assert.equal(await readFile(join(outside, 'allowed.txt'), 'utf8'), 'outside\n')
  } finally {
    await cleanup()
  }
})

test('a deployment without a policy service fences nothing', async () => {
  const { root, outside, cleanup } = await workspace()
  try {
    const fs = new PolicyFileSystem(new Context(), root, undefined)
    const target = await fs.resolve(join(outside, 'unfenced.txt'))
    await fs.writeText(target, 'unfenced\n')
    assert.equal(await readFile(join(outside, 'unfenced.txt'), 'utf8'), 'unfenced\n')
  } finally {
    await cleanup()
  }
})

test('an edit outside the workspace is denied as well', async () => {
  const { root, outside, cleanup } = await workspace()
  try {
    const fs = new PolicyFileSystem(new Context(), root, { mode: 'workspace-write', workspaceRoot: root })
    const target = await fs.resolve(join(outside, 'escape.txt'))
    assert.equal(
      await codeOf(fs.editText(target, { oldText: 'a', newText: 'b' } as never)),
      'FS_SANDBOX_DENIED',
    )
  } finally {
    await cleanup()
  }
})

test('the platform temp area stays writable, as the host policy promises', async () => {
  const { root, cleanup } = await workspace()
  try {
    const fs = new PolicyFileSystem(new Context(), root, { mode: 'workspace-write', workspaceRoot: root })
    const target = await fs.resolve(join(tmpdir(), `dsh-wsl-temp-${process.pid}.txt`))
    await fs.writeText(target, 'temp\n')
    assert.equal(await readFile(join(tmpdir(), `dsh-wsl-temp-${process.pid}.txt`), 'utf8'), 'temp\n')
    await rm(join(tmpdir(), `dsh-wsl-temp-${process.pid}.txt`), { force: true })
  } finally {
    await cleanup()
  }
})
