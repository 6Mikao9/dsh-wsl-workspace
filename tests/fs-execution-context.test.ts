import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { WslFileSystem } from '../src/fs.ts'

const sessionCwd = (distro: string) => `\\\\wsl.localhost\\${distro}\\home\\user\\project`

test('cwd-blind file tools inherit the calling session distribution', async () => {
  const ctx = new Context()
  await ctx.plugin(WslFileSystem, { distro: 'DefaultDistro' })
  const fs = ctx.fs as WslFileSystem
  const translate = (cwd: string) => ctx.waterfall(
    'tools/execute',
    { agent: { session: { header: { cwd } } } },
    async () => (fs as unknown as { translate(path: string): { input: string } }).translate('/tmp/file').input,
  )

  assert.deepEqual(await Promise.all([
    translate(sessionCwd('Ubuntu')),
    translate(sessionCwd('Debian')),
  ]), [
    '\\\\wsl.localhost\\Ubuntu\\tmp\\file',
    '\\\\wsl.localhost\\Debian\\tmp\\file',
  ])
})

test('agentless file calls retain the configured distribution fallback', async () => {
  const ctx = new Context()
  await ctx.plugin(WslFileSystem, { distro: 'ConfiguredDistro' })
  const fs = ctx.fs as WslFileSystem
  const translated = (fs as unknown as { translate(path: string): { input: string } }).translate('/tmp/file')
  assert.equal(translated.input, '\\\\wsl.localhost\\ConfiguredDistro\\tmp\\file')
})
