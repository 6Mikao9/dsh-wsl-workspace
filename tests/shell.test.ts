import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { WslShellExecutor } from '../src/shell.ts'

const config = {
  distro: 'Ubuntu',
  wslPath: 'wsl.exe',
  loginShell: true,
  timeoutMs: 120_000,
  maxTimeoutMs: 600_000,
  maxOutputBytes: 64_000,
  maxSpillBytes: 64_000,
  graceMs: 1_000,
}

function commandFor(workdir: string, loginShell: boolean): string {
  const executor = new WslShellExecutor(new Context(), { ...config, loginShell })
  const spec = executor.resolve({ command: 'pwd', workdir })
  const plan = (executor as unknown as { plan(value: typeof spec): { argv: readonly string[] } }).plan(spec)
  return plan.argv.at(-1) ?? ''
}

test('login shell preserves a workdir containing a single quote', () => {
  assert.equal(commandFor("/tmp/a'b", true), "cd '/tmp/a'\\''b' && pwd")
})

test('non-login shell leaves the command unchanged', () => {
  assert.equal(commandFor("/tmp/a'b", false), 'pwd')
})
