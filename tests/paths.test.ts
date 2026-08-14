/**
 * Unit tests for the pure path-translation core. Run with
 * `node --import tsx/esm --test tests/paths.test.ts` from the plugin directory.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAbsoluteLinuxPath,
  isValidWslUsername,
  isWindowsPathShaped,
  isWslUnc,
  joinUnc,
  mntToWindowsPath,
  normalizeLinuxPath,
  parseWslUnc,
  uncToLinux,
  windowsToMntPath,
} from '../src/shared/paths.ts'

test('parseWslUnc accepts the WSL2 localhost form', () => {
  assert.deepEqual(parseWslUnc('\\\\wsl.localhost\\Ubuntu\\home\\me\\proj'), {
    distro: 'Ubuntu',
    linuxPath: '/home/me/proj',
  })
})

test('parseWslUnc accepts the legacy wsl$ interop form', () => {
  assert.deepEqual(parseWslUnc('\\\\wsl$\\Debian\\etc\\hosts'), {
    distro: 'Debian',
    linuxPath: '/etc/hosts',
  })
})

test('parseWslUnc accepts forward-slash spellings', () => {
  assert.deepEqual(parseWslUnc('//wsl.localhost/Ubuntu/var/log'), {
    distro: 'Ubuntu',
    linuxPath: '/var/log',
  })
})

test('parseWslUnc maps the distribution root to "/"', () => {
  assert.deepEqual(parseWslUnc('\\\\wsl.localhost\\Ubuntu\\'), {
    distro: 'Ubuntu',
    linuxPath: '/',
  })
})

test('parseWslUnc rejects non-WSL paths', () => {
  for (const bad of ['C:\\work', '\\\\server\\share\\x', '/home/me', 'wsl.localhost\\Ubuntu\\x', '']) {
    assert.equal(parseWslUnc(bad), null, `expected null for ${JSON.stringify(bad)}`)
  }
})

test('isWslUnc mirrors parseWslUnc', () => {
  assert.equal(isWslUnc('\\\\wsl.localhost\\Ubuntu\\x'), true)
  assert.equal(isWslUnc('C:\\x'), false)
})

test('uncToLinux strips the UNC prefix', () => {
  assert.equal(uncToLinux('\\\\wsl.localhost\\Ubuntu\\home\\me\\proj'), '/home/me/proj')
})

test('uncToLinux throws on non-WSL input', () => {
  assert.throws(() => uncToLinux('C:\\work'), /not a WSL UNC path/)
})

test('joinUnc round-trips with parseWslUnc', () => {
  const unc = joinUnc('Ubuntu', '/home/me/proj')
  assert.equal(unc, '\\\\wsl.localhost\\Ubuntu\\home\\me\\proj')
  assert.deepEqual(parseWslUnc(unc), { distro: 'Ubuntu', linuxPath: '/home/me/proj' })
})

test('joinUnc maps the root to a bare distro share', () => {
  assert.equal(joinUnc('Ubuntu', '/'), '\\\\wsl.localhost\\Ubuntu')
  assert.deepEqual(parseWslUnc(joinUnc('Ubuntu', '/')), { distro: 'Ubuntu', linuxPath: '/' })
})

test('joinUnc rejects non-absolute Linux paths', () => {
  assert.throws(() => joinUnc('Ubuntu', 'relative/path'), /non-absolute Linux path/)
})

test('joinUnc rejects separator or dot-dir distro names (UNC escape guard)', () => {
  for (const bad of ['', '.', '..', 'Ubuntu\\x', 'a/b']) {
    assert.throws(() => joinUnc(bad, '/home'), /invalid distribution name/, `expected reject for ${JSON.stringify(bad)}`)
  }
})

test('normalizeLinuxPath collapses slashes and trims trailing slash', () => {
  assert.equal(normalizeLinuxPath('/home//me///proj/'), '/home/me/proj')
  assert.equal(normalizeLinuxPath('/'), '/')
})

test('isAbsoluteLinuxPath requires a leading slash', () => {
  assert.equal(isAbsoluteLinuxPath('/home'), true)
  assert.equal(isAbsoluteLinuxPath('home'), false)
  assert.equal(isAbsoluteLinuxPath('/bad\u0000'), false)
})

test('windowsToMntPath maps drive letters under /mnt', () => {
  assert.equal(windowsToMntPath('C:\\work\\src'), '/mnt/c/work/src')
  assert.equal(windowsToMntPath('D:/other'), '/mnt/d/other')
  assert.equal(windowsToMntPath('C:\\'), '/mnt/c')
  assert.equal(windowsToMntPath('x:\\'), '/mnt/x')
  assert.equal(windowsToMntPath('no-drive'), null)
})

test('mntToWindowsPath round-trips with windowsToMntPath', () => {
  for (const win of ['C:\\work\\src', 'D:\\', 'E:\\a b\\c']) {
    const mnt = windowsToMntPath(win)
    assert.notEqual(mnt, null)
    assert.equal(mntToWindowsPath(mnt!), win.replace(/\//g, '\\'))
  }
  assert.equal(mntToWindowsPath('/home/me'), null)
})

test('isWindowsPathShaped classifies path values for WSLENV', () => {
  assert.equal(isWindowsPathShaped('C:\\Users\\me'), true)
  assert.equal(isWindowsPathShaped('\\\\wsl.localhost\\Ubuntu'), true)
  assert.equal(isWindowsPathShaped('/home/me'), false)
  assert.equal(isWindowsPathShaped('plain-value'), false)
})

test('isValidWslUsername accepts Linux-shaped usernames', () => {
  for (const good of ['root', 'me', '_svc', 'user.name', 'user-1', 'U_2.x']) {
    assert.equal(isValidWslUsername(good), true, `expected accept for ${JSON.stringify(good)}`)
  }
})

test('isValidWslUsername rejects option-like or malformed usernames', () => {
  for (const bad of ['', '-x', '1abc', 'a b', 'a/b', 'a\nb', 'x'.repeat(65), '..', '.', 'a\\b']) {
    assert.equal(isValidWslUsername(bad), false, `expected reject for ${JSON.stringify(bad)}`)
  }
})
