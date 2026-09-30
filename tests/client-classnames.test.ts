/**
 * Client class-name cross-check.
 *
 * `src/client/styles.ts` is one CSS string and the repository has no `.css` file
 * (`find src -name '*.css'` → 0), so TypeScript cannot see the pairing between a class a
 * component applies and the rule that styles it. A `className` with no rule is invisible:
 * the element renders with browser defaults and nobody notices until someone looks at the
 * sidebar. This is the check that would have caught the shape found in the v0.7.5 review —
 * `dww-action--wide` and `dww-feedback` are applied and have no rule at all.
 *
 * Two halves, deliberately different in strength:
 *  - every className token must either have a rule or appear in UNSTYLED with a reason;
 *  - a BEM modifier (`block--modifier`) may NOT be exempted by silence — it is listed in
 *    MISSING_MODIFIER_RULES only with the product ticket that owns it, because a modifier
 *    exists for no other reason than to be styled.
 *
 * ids are excluded on purpose: `htmlFor="dww-distro"` / `id="dww-distro"` are a label
 * association, not a style hook (three of the five tokens a naive scan flags are exactly
 * that). `id=` is still checked, against its own vocabulary, for collisions.
 *
 *   node --test --experimental-strip-types tests/client-classnames.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')

/**
 * classNames that are applied without a rule and where that is a decision, not a gap.
 * Each entry must say why the element is intentionally unstyled.
 */
const UNSTYLED = new Map<string, string>([
  ['dww-feedback', 'structural wrapper: its children .dww-breadcrumb and .dww-dirlist carry the '
    + 'rules, and the token has no same-prefix block (`dww-feedback` is not a `block--modifier` '
    + 'of anything), so it is a container name rather than an unstyled state'],
])

/**
 * BEM modifiers with no rule. Not a permission — every entry must name the product ticket
 * that fixes it, because a modifier exists for no other reason than to be styled. Which
 * tokens are modifiers is decided by SHAPE (`block--x` where the `block` class itself is
 * also applied), not by hand-classification: that is what distinguishes `dww-action--wide`
 * (a real state with no rule, so it owes a ticket) from `dww-feedback` (not a modifier).
 */
const MISSING_MODIFIER_RULES = new Map<string, string>([
  ['dww-action--wide', 'no rule: the sidebar button renders identically wide and rail; '
    + 'product ticket pending (v0.7.5 review finding 8 / issue #44 §6) — the wide-state '
    + 'geometry is a design decision, not the test layer — to invent'],
])

/** True when `token` is a `block--modifier` whose `block` is itself applied somewhere. */
function isRealModifier(token: string): boolean {
  const separator = token.indexOf('--')
  if (separator <= 0) return false
  return usedByToken.has(token.slice(0, separator))
}

/** Every `dww-*` string literal inside a `className={...}` / `className="..."` attribute. */
function classNamesIn(source: string): string[] {
  const found: string[] = []
  const attr = /className\s*=\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|"[^"]*"|'[^']*'|`[^`]*`)/g
  for (const match of source.matchAll(attr)) {
    const attribute = match[1]
    if (attribute === undefined) continue
    for (const token of attribute.matchAll(/[`'"](dww-[A-Za-z0-9_-]+)[`'"]/g)) {
      if (token[1] !== undefined) found.push(token[1])
    }
    // `className="dww-a dww-b"` carries several tokens in one literal: split on whitespace too.
    for (const chunk of attribute.matchAll(/["'`]([^"'`]*)["'`]/g)) {
      if (chunk[1] === undefined) continue
      for (const word of chunk[1].split(/\s+/)) {
        if (/^dww-[A-Za-z0-9_-]+$/.test(word)) found.push(word)
      }
    }
  }
  return found
}

/** Class tokens that appear in a selector position of the stylesheet. */
function definedSelectors(styles: string): Set<string> {
  const defined = new Set<string>()
  for (const rawLine of styles.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
    const brace = line.indexOf('{')
    // A rule line contributes every `.dww-*` before its brace; a continuation line of a
    // comma-separated selector list contributes every `.dww-*` it contains.
    const scope = brace >= 0 ? line.slice(0, brace) : (/^[.,&]/.test(line) ? line : '')
    for (const match of scope.matchAll(/\.dww-[A-Za-z0-9_-]+/g)) defined.add(match[0].slice(1))
  }
  return defined
}

const files = readdirSync(clientDir).filter(name => /\.(tsx|ts)$/.test(name) && name !== 'styles.ts')
const usedByToken = new Map<string, string>()
for (const name of files) {
  const source = readFileSync(join(clientDir, name), 'utf8')
  for (const token of classNamesIn(source)) if (!usedByToken.has(token)) usedByToken.set(token, name)
}
const stylesSource = readFileSync(join(clientDir, 'styles.ts'), 'utf8')
const defined = definedSelectors(stylesSource)

test('the scan actually finds classNames (a regex that matched nothing would pass vacuously)', () => {
  assert.ok(usedByToken.size >= 25, `expected dozens of classNames, found ${usedByToken.size}`)
  assert.ok(defined.size >= 25, `expected dozens of selectors, found ${defined.size}`)
  // Anchor on a token that must exist on both sides, so a broken scanner cannot read as clean.
  assert.ok(usedByToken.has('dww-card'), 'dww-card must be seen as used')
  assert.ok(defined.has('dww-card'), 'dww-card must be seen as styled')
})

test('every applied className has a rule or a stated reason', () => {
  const unexplained: string[] = []
  for (const [token, file] of usedByToken) {
    if (defined.has(token)) continue
    if (UNSTYLED.has(token)) continue
    if (MISSING_MODIFIER_RULES.has(token)) continue
    unexplained.push(`${token} (applied in ${file}, no rule in styles.ts)`)
  }
  assert.deepEqual(unexplained, [], `unstyled classNames: ${unexplained.join('; ')}`)
})

test('a real modifier without a rule owes a ticket, and an unstyled container owes a reason', () => {
  // Shape decides who owes what: `block--state` of a block that is itself applied is a real
  // state and cannot be waved through with a prose reason.
  const unregistered: string[] = []
  for (const token of usedByToken.keys()) {
    if (defined.has(token) || !isRealModifier(token)) continue
    if (!MISSING_MODIFIER_RULES.has(token)) unregistered.push(token)
  }
  assert.deepEqual(unregistered, [], `unstyled modifiers registered nowhere: ${unregistered.join(', ')}`)

  for (const [token, reason] of MISSING_MODIFIER_RULES) {
    assert.ok(isRealModifier(token), `${token} is registered as a modifier but has no applied block — `
      + 'move it to UNSTYLED with a reason')
    assert.match(reason, /#\d+/, `${token} is exempted without a ticket reference`)
    assert.ok(reason.length > 40, `${token} has a stub reason`)
  }
  for (const [token, reason] of UNSTYLED) {
    assert.ok(!isRealModifier(token), `${token} is a real modifier — it must be registered with a ticket`)
    assert.ok(reason.length > 40, `${token} has a stub reason`)
  }
})

test('an exemption is not left behind once the rule exists', () => {
  const stale = [...UNSTYLED.keys()].filter(token => defined.has(token))
  assert.deepEqual(stale, [], `${stale.join(', ')} now have rules — delete the exemption line`)
  const fixedModifiers = [...MISSING_MODIFIER_RULES.keys()].filter(token => defined.has(token))
  assert.deepEqual(fixedModifiers, [],
    `${fixedModifiers.join(', ')} got their rules — delete the registration, that deletion is the closure`)
})

test('no selector is defined that nothing applies', () => {
  // Dead CSS in a 356-line string is maintenance cost with no owner. A token added here must
  // be either used by a component or a documented host-state hook.
  const orphan = [...defined].filter(token => !usedByToken.has(token)
    && !(MISSING_MODIFIER_RULES.has(token) || UNSTYLED.has(token)))
  assert.deepEqual(orphan, [], `rules with no consumer: ${orphan.join(', ')}`)
})

test('ids are unique per dialog and every htmlFor has a matching id', () => {
  const ids = new Set<string>()
  const labels = new Set<string>()
  for (const name of files) {
    const source = readFileSync(join(clientDir, name), 'utf8')
    for (const match of source.matchAll(/\bid\s*=\s*["'`](dww-[A-Za-z0-9_-]+)["'`]/g)) {
      if (match[1] !== undefined) ids.add(match[1])
    }
    for (const match of source.matchAll(/\bhtmlFor\s*=\s*["'`](dww-[A-Za-z0-9_-]+)["'`]/g)) {
      if (match[1] !== undefined) labels.add(match[1])
    }
  }
  assert.ok(ids.size > 0, 'the scan must see the dialog ids or this assertion is vacuous')
  const dangling = [...labels].filter(label => !ids.has(label))
  assert.deepEqual(dangling, [], `htmlFor without an element id: ${dangling.join(', ')}`)
})
