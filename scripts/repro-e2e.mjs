// End-to-end verification of the WSL skills provider against the REAL
// \\wsl.localhost 9P share (requires WSL + the repro tree from repro-setup.sh).
//   node scripts/repro-e2e.mjs
// Override the target with WSL_COMPAT_DISTRO / WSL_COMPAT_USER and the tree
// location with WSL_REPRO_ROOT (NOT WSL_COMPAT_ROOT — in the compatibility
// drivers that name means "fixture parent under /tmp", a different thing).
//
// This file used to PRINT four listings while TESTING.md and docs/CHECK-CATALOG.md
// described it as carrying assertions. It carried none: `grep -cE 'assert|throw|exit'`
// on its 34 lines returned 0, so a regression in nested skill discovery could print an
// empty catalogue and still exit 0. It now asserts, and the negative cases the fixture
// builds (node_modules, a dot-directory, a tree past MAX_SCAN_DEPTH) are pinned too —
// a discovery test that only checks what should appear cannot catch over-scanning.
import assert from 'node:assert/strict'
import { WslSkillsProvider } from '../src/host/wsl-skills.ts'

const control = { signal: new AbortController().signal, invalidate: () => {} }
const provider = new WslSkillsProvider(control)

const distro = process.env.WSL_COMPAT_DISTRO ?? 'Ubuntu'
const user = process.env.WSL_COMPAT_USER ?? 'mille'
const rootPath = process.env.WSL_REPRO_ROOT ?? `/home/${user}/repro-ws-root`
const workspaceRoot = `\\\\wsl.localhost\\${distro}\\${rootPath.replaceAll('/', '\\')}`
const nestedProject = `${workspaceRoot}\\proj-a`

/** The `name` of every entry a listing returned, for set-shaped assertions. */
const namesOf = (list) => list.map(skill => skill.name)

let failures = 0
function check(label, body) {
  try {
    body()
    console.log(`ok: ${label}`)
  } catch (error) {
    failures += 1
    console.error(`not ok: ${label}\n    ${String(error.message).split('\n').join('\n    ')}`)
  }
}

console.log(`repro tree: ${workspaceRoot}`)

console.log('\n== 1. provider.list with cwd = workspace root (the #10 bug scenario) ==')
const fromRoot = await provider.list({ cwd: workspaceRoot })
console.log(namesOf(fromRoot).join(', ') || '(none)')
check('the workspace root sees its own skill', () => assert.ok(namesOf(fromRoot).includes('root-skill')))
check('the workspace root reaches the NESTED projects, which is what #10 broke', () => {
  assert.deepEqual(
    ['brainstorming', 'systematic-debugging', 'writing-plans'].filter(n => !namesOf(fromRoot).includes(n)),
    [],
  )
})
check('pruned trees never surface (node_modules, dot-directory, past MAX_SCAN_DEPTH)', () => {
  const forbidden = ['hidden', 'dot', 'deep-skill']
  assert.deepEqual(namesOf(fromRoot).filter(n => forbidden.includes(n)), [])
})
check('each entry still carries the provider attribution and a rank', () => {
  for (const skill of fromRoot) {
    assert.equal(typeof skill.name, 'string', 'name must be a string')
    assert.ok(skill.source !== undefined && skill.source !== '', `${skill.name} has no source`)
    assert.equal(typeof skill.rank, 'number', `${skill.name} has no numeric rank`)
  }
})

console.log('\n== 2. provider.list with cwd = nested project (host-parity reference) ==')
const fromNested = await provider.list({ cwd: nestedProject })
console.log(namesOf(fromNested).join(', ') || '(none)')
check('a nested project sees its own skills', () => {
  assert.ok(namesOf(fromNested).includes('brainstorming'))
  assert.ok(namesOf(fromNested).includes('systematic-debugging'))
})
check('a nested project does not see a sibling project\'s skills', () => {
  assert.ok(!namesOf(fromNested).includes('writing-plans'),
    `proj-a must not serve proj-b's writing-plans; got ${namesOf(fromNested).join(', ')}`)
})

console.log('\n== 3. provider.get(body load) ==')
const first = fromRoot[0]
if (first !== undefined) {
  const def = await provider.get(first, { cwd: workspaceRoot })
  console.log(`${def.name}: ${JSON.stringify(def.content)}`)
  check('get() returns the entry asked for, with a non-empty body', () => {
    assert.equal(def.name, first.name)
    assert.ok(typeof def.content === 'string' && def.content.trim() !== '', 'body must not be empty')
  })
} else {
  check('a non-empty root listing is required before a body can be loaded', () => {
    assert.fail('provider.list returned nothing — the repro tree is missing (run repro-setup.sh) '
      + 'or discovery is broken; either way this run cannot pass')
  })
}

console.log('\n== 4. non-WSL cwd stays untouched ==')
const outside = await provider.list({ cwd: 'D:\\ProgramData\\dsh-wsl-workspace' })
console.log(JSON.stringify(namesOf(outside)))
check('the provider returns nothing for a non-WSL cwd rather than reaching into it', () => {
  assert.deepEqual(outside, [], `expected no skills outside a WSL world, got ${namesOf(outside).join(', ')}`)
})

console.log(failures === 0
  ? 'REPRO E2E PASSED (10 assertions)'
  : `REPRO E2E FAILED (${failures} failing)`)
process.exit(failures === 0 ? 0 : 1)
