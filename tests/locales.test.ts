/**
 * Locale dictionary parity. The `wslWorkspace` namespace is registered from
 * both dictionaries at once, so a key that exists in only one of them renders
 * as a bare key (or an untranslated string) in the other language.
 *
 * Run with `node --test --experimental-strip-types tests/locales.test.ts`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { en, zh } from '../src/client/locales.ts'

test('zh and en expose exactly the same keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})

test('no dictionary value is blank', () => {
  for (const [key, value] of Object.entries(zh)) {
    assert.ok(value.trim() !== '', `zh ${key} is blank`)
  }
  for (const [key, value] of Object.entries(en)) {
    assert.ok(value.trim() !== '', `en ${key} is blank`)
  }
})

test('the help panel body strings are bullet lists, not one runaway line', () => {
  for (const [key, value] of [...Object.entries(zh), ...Object.entries(en)]) {
    if (!key.startsWith('help.') || !key.endsWith('.body')) continue
    const bullets = value.split('\n').filter(line => line.trim() !== '')
    assert.ok(bullets.length >= 2, `${key} should hold at least two bullets`)
    for (const bullet of bullets) assert.ok(bullet.length <= 320, `${key} has an over-long bullet`)
  }
})
