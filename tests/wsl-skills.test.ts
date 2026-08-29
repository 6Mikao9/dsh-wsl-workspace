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
  symlink?: boolean
  unreadable?: boolean
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

/** Mark an existing directory as a directory symlink (the fake has real paths, not link targets). */
function markSymlink(node: FakeNode, path: string[]): void {
  dir(node, path).symlink = true
}

/** Point `fromPath` at the existing directory `toPath`, modelling a directory symlink. */
function linkDir(node: FakeNode, fromPath: string[], toPath: string[]): void {
  const target = dir(node, toPath)
  target.symlink = true
  const parent = dir(node, fromPath.slice(0, -1))
  parent.children?.set(fromPath[fromPath.length - 1] ?? '', target)
}

function file(node: FakeNode, path: string[], content: string): void {
  const parent = dir(node, path.slice(0, -1))
  parent.children?.set(path[path.length - 1] ?? '', { directory: false, content })
}

const SKILL_MD = (name: string, description: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nBody of ${name}.\n`

function createIo(root: FakeNode, options: { resolveSymlinks?: boolean } = {}): WslSkillIo {
  const resolveSymlinks = options.resolveSymlinks ?? false
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
      if (node.unreadable === true) throw new Error(`EACCES: ${path}`)
      return [...(node.children?.entries() ?? [])].map(([name, child]) => ({
        name,
        isDirectory: () => child.directory && child.symlink !== true,
        isFile: () => !child.directory,
        isSymbolicLink: () => child.symlink === true,
      }))
    },
    readFile: async (path) => {
      const node = resolve(path)
      if (node === undefined || node.directory) throw new Error(`ENOENT: ${path}`)
      return node.content ?? ''
    },
    stat: async (path) => {
      const node = resolve(path)
      // Model the `\\wsl.localhost` 9P share by default: Linux symlinks are
      // reported by readdir but their targets cannot be resolved Windows-side.
      if (node !== undefined && node.symlink === true && !resolveSymlinks) {
        throw new Error(`ENOENT (9P cannot follow): ${path}`)
      }
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

test('caches a completed lookup and serves it until the TTL expires', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    SKILL_MD('brainstorming', 'Structured brainstorming'))

  let readdirCalls = 0
  const io = createIo(root)
  const countingIo: WslSkillIo = {
    readdir: async (path, options) => {
      readdirCalls += 1
      return io.readdir(path, options)
    },
    readFile: io.readFile,
    stat: io.stat,
  }
  let clock = 1_000_000
  const provider = new WslSkillsProvider(control(), countingIo, () => clock)

  const first = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  const readsAfterFirst = readdirCalls
  assert.equal(first.length, 1)
  assert.ok(readsAfterFirst > 0)

  // Served from cache: no additional filesystem traffic.
  const second = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.equal(readdirCalls, readsAfterFirst)
  assert.deepEqual(second.map(skill => skill.name), ['brainstorming'])

  // The cached array is a copy: callers cannot poison the cache.
  second.push({ ...second[0]!, name: 'poison' })
  const third = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(third.map(skill => skill.name), ['brainstorming'])

  // After the TTL the stale copy is served immediately while a background
  // refresh runs; the following lookup sees the refreshed content.
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'late.md'],
    SKILL_MD('late', 'Added after caching'))
  clock += 10_001
  const stale = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(stale.map(skill => skill.name), ['brainstorming'])

  await new Promise(resolve => setTimeout(resolve, 20)) // let the refresh land
  const refreshedCalls = readdirCalls
  assert.ok(refreshedCalls > readsAfterFirst)
  const fresh = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(fresh.map(skill => skill.name).sort(), ['brainstorming', 'late'])
  // The refreshed entry is cached again: no further filesystem traffic.
  const again = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.equal(readdirCalls, refreshedCalls)
  assert.deepEqual(again.map(skill => skill.name).sort(), ['brainstorming', 'late'])
})

test('expired lookups share a single background refresh', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    SKILL_MD('brainstorming', 'Structured brainstorming'))
  let readdirCalls = 0
  const io = createIo(root)
  const countingIo: WslSkillIo = {
    readdir: async (path, options) => {
      readdirCalls += 1
      return io.readdir(path, options)
    },
    readFile: io.readFile,
    stat: io.stat,
  }
  let clock = 1_000_000
  const provider = new WslSkillsProvider(control(), countingIo, () => clock)

  const first = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  const readsAfterFirst = readdirCalls
  assert.equal(first.length, 1)

  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'late.md'],
    SKILL_MD('late', 'Added after caching'))
  clock += 10_001
  // Overlapping expired lookups both serve the same stale copy while a
  // single background refresh runs; afterwards the refreshed content wins.
  const staleA = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  const staleB = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(staleA.map(skill => skill.name), ['brainstorming'])
  assert.deepEqual(staleB.map(skill => skill.name), ['brainstorming'])

  await new Promise(resolve => setTimeout(resolve, 20))
  const fresh = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(fresh.map(skill => skill.name).sort(), ['brainstorming', 'late'])
})

test('get() re-reads the body instead of serving a cached one', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    SKILL_MD('brainstorming', 'Structured brainstorming'))
  const provider = new WslSkillsProvider(control(), createIo(root))
  const [candidate] = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.ok(candidate !== undefined)
  const before = await provider.get(candidate, { cwd: CWD_WORKSPACE_ROOT })
  assert.equal(before?.content, 'Body of brainstorming.')
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    '---\nname: brainstorming\ndescription: Structured brainstorming\n---\n\nRewritten body.\n')
  const after = await provider.get(candidate, { cwd: CWD_WORKSPACE_ROOT })
  assert.equal(after?.content, 'Rewritten body.')
})

test('prunes unresolvable directory symlinks without failing the scan', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'real-project', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'real-project', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    SKILL_MD('brainstorming', 'Structured brainstorming'))
  // A Linux symlink into the workspace (the 9P share cannot resolve its
  // target) and a dangling link must both be skipped without noise.
  markSymlink(root, ['home', 'mille', 'repro-ws-root', 'linked-project'])
  {
    const parent = dir(root, ['home', 'mille', 'repro-ws-root'])
    parent.children?.set('dangling', { directory: false, symlink: true })
  }

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills.map(skill => skill.name), ['brainstorming'])
})

test('publishes aliased skill files once when the substrate resolves symlinks', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'real-project', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'real-project', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    SKILL_MD('brainstorming', 'Structured brainstorming'))
  linkDir(root, ['home', 'mille', 'repro-ws-root', 'linked-project'], ['home', 'mille', 'repro-ws-root', 'real-project'])

  // A substrate that resolves symlink targets (e.g. a future share or a
  // local-directory lookup): the project is discovered via both paths and
  // the name+body fingerprint dedupe must publish it exactly once.
  const provider = new WslSkillsProvider(control(), createIo(root, { resolveSymlinks: true }))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills.map(skill => skill.name), ['brainstorming'])
})

test('bounds symlink hops by the depth budget on resolving substrates', async () => {
  const root = tree()
  markSymlink(root, ['home', 'mille', 'repro-ws-root', 'p1', 'p2', 'p3', 'p4', 'p5'])
  const provider = new WslSkillsProvider(control(), createIo(root, { resolveSymlinks: true }))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills, [])
})

test('parses block scalars in frontmatter', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills', 'literal.md'],
    '---\nname: literal\ndescription: |\n  First line of the description.\n  Second line.\nwhenToUse: >\n  Folded when-to-use\n  spanning two lines.\nuser-invocable: false\n---\n\nLiteral body.\n')
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills', 'folded.md'],
    '---\nname: folded\ndescription: >\n  A folded description\n  on two source lines.\n---\n\nFolded body.\n')
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills', 'mixed.md'],
    '---\nname: mixed\ndescription: Single line stays unchanged\nwhenToUse: |\n  Multi-line\n  when to use\n---\n\nMixed body.\n')

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills.map(skill => skill.name).sort(), ['folded', 'literal', 'mixed'])
  const literal = skills.find(skill => skill.name === 'literal')
  assert.equal(literal?.description, 'First line of the description.\nSecond line.')
  assert.equal(literal?.whenToUse, 'Folded when-to-use spanning two lines.')
  const folded = skills.find(skill => skill.name === 'folded')
  assert.equal(folded?.description, 'A folded description on two source lines.')
  const mixed = skills.find(skill => skill.name === 'mixed')
  assert.equal(mixed?.whenToUse, 'Multi-line\nwhen to use')
})

test('accepts every UNC spelling of the same workspace', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    SKILL_MD('brainstorming', 'Structured brainstorming'))
  const provider = new WslSkillsProvider(control(), createIo(root))
  for (const cwd of [
    CWD_WORKSPACE_ROOT,
    '\\\\wsl$\\Ubuntu\\home\\mille\\repro-ws-root',
    '\\\\WSL.LOCALHOST\\Ubuntu\\home\\mille\\repro-ws-root',
    '\\\\wsl.localhost\\Ubuntu\\home\\mille\\repro-ws-root\\',
    '//wsl.localhost/Ubuntu/home/mille/repro-ws-root',
  ]) {
    const skills = await provider.list({ cwd })
    assert.deepEqual(skills.map(skill => skill.name), ['brainstorming'], `cwd spelling: ${cwd}`)
  }
})

test('a distro-root cwd scans from / and still honors the depth budget', async () => {
  const root = tree()
  // proj-a sits 4 levels below the filesystem root: within MAX_SCAN_DEPTH.
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'brainstorming', 'SKILL.md'],
    SKILL_MD('brainstorming', 'Structured brainstorming'))
  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: '\\\\wsl.localhost\\Ubuntu' })
  assert.deepEqual(skills.map(skill => skill.name), ['brainstorming'])
})

test('an unreadable directory is pruned while siblings keep scanning', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'locked', 'secret', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'locked', 'secret', '.dsh', 'skills', 'hidden.md'],
    SKILL_MD('hidden', 'Behind an unreadable directory'))
  dir(root, ['home', 'mille', 'repro-ws-root', 'locked']).unreadable = true
  dir(root, ['home', 'mille', 'repro-ws-root', 'open', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'open', '.dsh', 'skills', 'visible.md'],
    SKILL_MD('visible', 'Normal sibling'))

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills.map(skill => skill.name), ['visible'])
})

test('parses CRLF skill files including CRLF block scalars', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills', 'windows.md'],
    '---\r\nname: windows\r\ndescription: Saved by a Windows editor\r\nwhenToUse: |\r\n  Folded across\r\n  two CRLF lines\r\n---\r\n\r\nCRLF body.\r\n')

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills.map(skill => skill.name), ['windows'])
  assert.equal(skills[0]?.description, 'Saved by a Windows editor')
  assert.equal(skills[0]?.whenToUse, 'Folded across\ntwo CRLF lines')
})

test('parses UTF-8 BOM skill files', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills'])
  file(root, ['home', 'mille', 'repro-ws-root', 'proj', '.dsh', 'skills', 'bommy.md'],
    '\uFEFF---\nname: bommy\ndescription: Saved with a BOM\n---\n\nBOM body.\n')

  const provider = new WslSkillsProvider(control(), createIo(root))
  const skills = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.deepEqual(skills.map(skill => skill.name), ['bommy'])
})

test('get() refuses a candidate whose file changed identity', async () => {
  const root = tree()
  dir(root, ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills'])
  const skillPath = ['home', 'mille', 'repro-ws-root', 'proj-a', '.dsh', 'skills', 'brainstorming', 'SKILL.md']
  file(root, skillPath, SKILL_MD('brainstorming', 'Structured brainstorming'))
  const provider = new WslSkillsProvider(control(), createIo(root))
  const [candidate] = await provider.list({ cwd: CWD_WORKSPACE_ROOT })
  assert.ok(candidate !== undefined)
  file(root, skillPath, SKILL_MD('renamed-away', 'The frontmatter name changed'))
  const definition = await provider.get(candidate, { cwd: CWD_WORKSPACE_ROOT })
  assert.equal(definition, undefined)
})

test('network UNC shares that are not WSL stay untouched', async () => {
  const provider = new WslSkillsProvider(control(), createIo(tree()))
  assert.deepEqual(await provider.list({ cwd: '\\\\fileserver\\projects\\app' }), [])
})