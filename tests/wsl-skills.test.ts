/**
 * Unit tests for the WSL workspace skill provider. Run with
 * `node --test tests/wsl-skills.test.ts` from the plugin directory
 * (Node >= 23.6 strips types natively).
 *
 * The provider reads the `\\wsl.localhost\…` 9P share through an injectable
 * IO face; these tests drive that face with an in-memory tree, so they run
 * without a live distro. `tests/repro-e2e.mjs` exercises the same provider
 * against a real WSL tree.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WslSkillsProvider, type WslSkillIo } from '../src/host/wsl-skills.ts'

/** In-memory filesystem node. */
interface FakeNode {
  directory: boolean
  content?: string
  children?: Map<string, FakeNode>
}

/** Build an in-memory tree below one WSL UNC root. */
function tree(): FakeNode {
  return { directory: true, children: new Map() }
}

function dir(node: FakeNode, path: string[]): FakeNode {
  let current = node
  for (const segment of path) {
    let child = current.children?.get(segment)
    if (child === undefined) {
      child = { directory: true, children: new Map() }
      current.children?.set(segment, child)
    }
    current = child
  }
  return current
}

function file(node: FakeNode, path: string[], content: string): void {
  const parent = dir(node, path.slice(0, -1))
  parent.children?.set(path[path.length - 1] ?? '', { directory: false, content })
}

const SKILL_MD = (name: string, description: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nBody of ${name}.\n`

function createIo(root: FakeNode): WslSkillIo {
  const resolve = (path: string): FakeNode | undefined => {
    // Provider hands over `\\wsl.localhost\<distro>\<linux>` UNC spellings.
    const forward = path.replace(/\\/g, '/')
    const match = /^\/\/wsl\.localhost\/[^/]+(\/.*)?$/.exec(forward)
    if (match === null) return undefined
    const linux = match[1] ?? '/'
    const segments = linux.split('/').filter(segment => segment.length > 0)
    let current = root
    for (const segment of segments) {
      const child = current.children?.get(segment)
      if (child === undefined) return undefined
      current = child
    }
    return current
  }
  return {
    readdir: async (path) => {
      const node = resolve(path)
      if (node === undefined || !node.directory) throw new Error(`ENOENT: ${path}`)
      return [...(node.children?.entries() ?? [])].map(([name, child]) => ({
        name,
        isDirectory: () => child.directory,
        isFile: () => !child.directory,
      }))
    },
    readFile: async (path) => {
      const node = resolve(path)
      if (node === undefined || node.directory) throw new Error(`ENOENT: ${path}`)
      return node.content ?? ''
    },
    stat: async (path) => {
      const node = resolve(path)
      if (node === undefined) throw new Error(`ENOENT: ${path}`)
      return { isDirectory: () => node.directory }
    },
  }
}

/** A no-op registration control (abortable only by the caller). */
function control(): { signal: AbortSignal; invalidate: () => void } {
  return { signal: new AbortController().signal, invalidate: () => {} }
}

const CWD_WORKSPACE_ROOT = '\\\\wsl.localhost\\Ubuntu\\home\\mille\\repro-ws-root'

test('returns nothing for non-WSL cwds', async () => {
  const provider = new WslSkillsProvider(control(), createIo(tree()))
  assert.deepEqual(await provider.list({ cwd: undefined }), [])
  assert.deepEqual(await provider.list({ cwd: 'D:\\ProgramData\\dsh-wsl-workspace' }), [])
  assert.deepEqual(await provider.list({ cwd: '/home/mille/proj' }), [])
})

test('discovers nested project skills under a WSL workspace root', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    SKILL_MD('brainstorming', 'Structured brainstorming'))
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'systematic-debugging', 'SKILL.md'],
    SKILL_MD('systematic-debugging', 'Systematic debugging walkthrough'))
  // A nested .agents/skills in a second project.
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj-b', '.agents', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-b', '.agents', 'skills', 'writing-plans.md'],
    SKILL_MD('writing-plans', 'Plan writing', 'whenToUse: When a task needs a plan\n'))

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })

  assert.deepEqual(skills.map(skill => skill.name).sort(), ['brainstorming', 'systematic-debugging', 'writing-plans'])
  const brainstorming = skills.find(skill => skill.name === 'brainstorming')
  assert.ok(brainstorming !== undefined)
  assert.equal(brainstorming.source, 'project-dsh')
  assert.equal(brainstorming.rank, 100)
  assert.equal(brainstorming.provider, 'wsl-workspace')
  assert.equal(brainstorming.locator.path, '\\\\wsl.localhost\\Ubuntu\\home\\mille\\repro-ws-root\\proj-a\\.dsh\\skills\\brainstorming\\SKILL.md')
  assert.equal(brainstorming.locator.directory, '\\\\wsl.localhost\\Ubuntu\\home\\mille\\repro-ws-root\\proj-a\\.dsh\\skills\\brainstorming')
  const plans = skills.find(skill => skill.name === 'writing-plans')
  assert.ok(plans !== undefined)
  assert.equal(plans.source, 'project-agents')
  assert.equal(plans.rank, 200)
  assert.equal(plans.whenToUse, 'When a task needs a plan')
})

test('get() returns the parsed body', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    SKILL_MD('brainstorming', 'Structured brainstorming'))

  const provider = new WslSkillsProvider(control(), createIo(root))
  const [candidate] = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.ok(candidate !== undefined)
  const definition = await provider.get(candidate, { cwd: CWD_WORKSPACE_ROOT })
  assert.equal(definition?.content, 'Body of brainstorming.')
  assert.equal(definition?.name, 'brainstorming')
})

test('skips pruned heavy directories and dot-directories while walking', async () => {
  const root = tree()
  // Skills deep inside node_modules or a dot-dir must NOT be discovered.
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj', 'node_modules', 'pkg', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', 'node_modules', 'pkg', '.dsh', 'skills', 'hidden.md'],
    SKILL_MD('hidden', 'Must not appear'))
  dir(root, ['home', 'mille', 'repro-ws-root', '.hidden-zone', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', '.hidden-zone', '.dsh', 'skills', 'dot.md'],
    SKILL_MD('dot', 'Must not appear either'))
  // The workspace root's own .dsh/skills is discovered (host-parity).
  dir(root, ['home', 'mille', 'repro-ws-root', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', '.dsh', 'skills', 'root-skill.md'],
    SKILL_MD('root-skill', 'At the workspace root'))

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills.map(skill => skill.name), ['root-skill'])
})

test('skips files without valid frontmatter and ignores unknown fields', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills', 'ok.md'],
    '---\nname: ok\ndescription: Fine skill\nmetadata: { x: 1 }\nuser-invocable: false\ndisable-model-invocation: true\n---\n\nOK body.\n')
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills', 'bad.md'],
    'no frontmatter at all')
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills', 'noname.md'],
    '---\ndescription: Missing name\n---\n\nNope.\n')

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills.map(skill => skill.name), ['ok'])
  assert.deepEqual(skills[0]?.invocation, { modelInvocable: false, userInvocable: false })
})

test('respects deep-nesting bounds and skill-root budget', async () => {
  const root = tree()
  // Skills at depth 5 (root=0, proj=1, a=2, b=3, c=4, d=5) exceed MAX_SCAN_DEPTH.
  dir(root, ['home', 'mille', 'repro-ws-root', 'p1', 'p2', 'p3', 'p4', 'deep', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'p1', 'p2', 'p3', 'p4', 'deep', '.dsh', 'skills', 'x.md'],
    SKILL_MD('x', 'Too deep'))
  // An in-bounds skill is still found.
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills', 'shallow.md'],
    SKILL_MD('shallow', 'In bounds'))

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills.map(skill => skill.name), ['shallow'])
})

const CWD_DEEP_IN_PROJECT = '\\\\wsl.localhost\\Ubuntu\\home\\mille\\ws\\proj-a\\src'

test('serves the enclosing project when the cwd sits deeper than the project root', async () => {
  const root = tree()
  // `.git` at `ws` makes it the nearest project root for `ws/proj-a/src`;
  // the host would serve its skills for that cwd, nested ones join via BFS.
  dir(root, ['home', 'mille', 'ws', '.git'])
  dir(root, ['home', 'mille', 'ws', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'ws', '.dsh', 'skills', 'workspace-skill.md'],
    SKILL_MD('workspace-skill', 'At the project root'))
  dir(root, ['home', 'mille', 'ws', 'proj-a', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'ws', 'proj-a', '.dsh', 'skills', 'nested-skill.md'],
    SKILL_MD('nested-skill', 'Nested below the project root'))

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_DEEP_IN_PROJECT })
  assert.deepEqual(skills.map(skill => skill.name).sort(), ['nested-skill', 'workspace-skill'])
})

test('does not leak skills above the nearest .git ancestor', async () => {
  const root = tree()
  // `proj-a` carries the `.git`, so a cwd inside it must see `proj-a`'s
  // skills — and nothing from the enclosing (non-project) directory.
  dir(root, ['home', 'mille', 'ws', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'ws', '.dsh', 'skills', 'outer.md'],
    SKILL_MD('outer', 'Above the project root'))
  dir(root, ['home', 'mille', 'ws', 'proj-a', '.git'])
  dir(root, ['home', 'mille', 'ws', 'proj-a', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'ws', 'proj-a', '.dsh', 'skills', 'inner.md'],
    SKILL_MD('inner', 'Inside the project root'))

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_DEEP_IN_PROJECT })
  assert.deepEqual(skills.map(skill => skill.name), ['inner'])
})

test('never publishes more than the skill-root budget', async () => {
  const root = tree()
  // 63 single-root projects, then one directory carrying both a `.dsh/skills`
  // and an `.agents/skills` root: publishing both unbounded would reach 65.
  for (let i = 0; i < 63; i += 1) {
    dir(root, ['home', 'mille', 'repro-ws-root', `p${i}`, '.dsh', 'skills'])
    file(root, ['home', 'mille', 'repro-ws-root', `p${i}`, '.dsh', 'skills', `s${i}.md`],
      SKILL_MD(`s${i}`, `Skill ${i}`))
  }
  dir(root, ['home', 'mille', 'repro-ws-root', 'last', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'last', '.dsh', 'skills', 'dsh.md'],
    SKILL_MD('dsh', 'Dsh root'))
  dir(root, ['home', 'mille', 'repro-ws-root', 'last', '.agents', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'last', '.agents', 'skills', 'agents.md'],
    SKILL_MD('agents', 'Agents root'))

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.equal(skills.length, 64)
  assert.ok(!skills.some(skill => skill.name === 'agents'))
})