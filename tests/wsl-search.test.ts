/**
 * Unit tests for the WSL search tools (host half).
 *
 * Everything here runs without a distribution: the record framing, the glob
 * matcher, the retention, the renderers and the argv builder are pure, and the
 * parts the host suite owns are checked against that package's own exported
 * formatters and its `present*Result` narrowing, so a wording or shape drift in
 * DSH cannot silently diverge from the WSL twin.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ItemRetainer } from '@deepseek-ai/dsh-output-retention'
import {
  formatGlobOutput,
  formatGrepOutput,
  presentGlobResult,
  presentGrepResult,
  sampleAcrossTopLevel,
} from '@deepseek-ai/dsh-tool-fs-search'
import {
  apply,
  buildWslArgv,
  capMetaBytes,
  displayPath,
  expandBraces,
  globCardPage,
  globSearchMeta,
  globToRegExp,
  grepSearchMeta,
  linuxTarget,
  matchGlob,
  parseGlobRecords,
  parseGrepRecords,
  renderGlobText,
  renderGrepText,
  resolveTarget,
  retainMatches,
  retainPaths,
} from '../src/host/wsl-search.ts'

/** The resolved plugin config (schemastery fills these in a real mount). */
const CONFIG = {
  grepMaxMatches: 250,
  grepMaxLineBytes: 2000,
  globMaxResults: 100,
  sampleOverCapGlobResults: false,
  searchMetaMaxBytes: 65536,
  rawOutputMaxBytes: 20_000_000,
  timeoutMs: 30_000,
  wslPath: 'wsl.exe',
}

describe('parseGrepRecords', () => {
  it('frames path, line number and text around colons, spaces and NULs', () => {
    // GNU grep prints `<path>\0<line>:<text>\n` per match, so each NUL-framed
    // segment carries the previous line's text AND the next match's path.
    const stdout = Buffer.from(
      '/ws/a file.txt\u000012:needs: a colon\n/ws/ünï.txt\u00003:中文 ünïcode\n',
      'utf8',
    )
    assert.deepEqual(parseGrepRecords(stdout), [
      { path: '/ws/a file.txt', lineNumber: 12, line: 'needs: a colon' },
      { path: '/ws/ünï.txt', lineNumber: 3, line: '中文 ünïcode' },
    ])
  })

  it('keeps a newline inside a path addressable', () => {
    const stdout = Buffer.from('/ws/od\nd name.txt\u00007:body\n', 'utf8')
    assert.deepEqual(parseGrepRecords(stdout), [
      { path: '/ws/od\nd name.txt', lineNumber: 7, line: 'body' },
    ])
  })

  it('drops a truncated tail and an empty stream without losing earlier matches', () => {
    assert.deepEqual(parseGrepRecords(Buffer.alloc(0)), [])
    assert.deepEqual(parseGrepRecords(Buffer.from('/ws/a.txt\u00001:one\n/ws/b.txt\u0000', 'utf8')), [
      { path: '/ws/a.txt', lineNumber: 1, line: 'one' },
    ])
  })
})

describe('parseGlobRecords', () => {
  it('reads the GNU listing with modification times', () => {
    assert.deepEqual(parseGlobRecords(Buffer.from('G /ws\n', 'utf8')), { mode: 'gnu', root: '/ws', files: [] })
    const withFiles = Buffer.from('G /ws\n1700000000.500000000\t/ws/a.txt\u00001700000001.250000000\t/ws/b c.txt\u0000', 'utf8')
    assert.deepEqual(parseGlobRecords(withFiles), {
      mode: 'gnu',
      root: '/ws',
      files: [
        { path: '/ws/a.txt', mtimeMs: 1_700_000_000_500 },
        { path: '/ws/b c.txt', mtimeMs: 1_700_000_001_250 },
      ],
    })
  })

  it('reads the plain fallback listing without times', () => {
    const stdout = Buffer.from('P /ws\n/ws/a.txt\u0000/ws/b.txt\u0000', 'utf8')
    assert.deepEqual(parseGlobRecords(stdout), {
      mode: 'plain',
      root: '/ws',
      files: [
        { path: '/ws/a.txt', mtimeMs: 0 },
        { path: '/ws/b.txt', mtimeMs: 0 },
      ],
    })
  })
})

describe('glob matching', () => {
  it('expands brace alternations', () => {
    assert.deepEqual(expandBraces('*.{js,jsx}'), ['*.js', '*.jsx'])
    assert.deepEqual(expandBraces('src/*.{a,b}.{c,d}'), ['src/*.a.c', 'src/*.a.d', 'src/*.b.c', 'src/*.b.d'])
    assert.deepEqual(expandBraces('plain.ts'), ['plain.ts'])
  })

  it('translates star, globstar, question mark, classes and braces', () => {
    assert.equal(globToRegExp('*').test('a/b'), false)
    assert.equal(globToRegExp('src/*.ts').test('src/a.ts'), true)
    assert.equal(globToRegExp('src/*.ts').test('src/deep/a.ts'), false)
    assert.equal(globToRegExp('**/*.ts').test('a.ts'), true)
    assert.equal(globToRegExp('**/*.ts').test('deep/nested/a.ts'), true)
    assert.equal(globToRegExp('a?c').test('abc'), true)
    assert.equal(globToRegExp('a?c').test('a/c'), false)
    assert.equal(globToRegExp('file[0-9].txt').test('file7.txt'), true)
    assert.equal(globToRegExp('file[!0-9].txt').test('filea.txt'), true)
    assert.equal(globToRegExp('*.{js,jsx}').test('a.jsx'), true)
    assert.equal(globToRegExp('a.b').test('axb'), false)
  })

  it('matches a basename when the pattern carries no separator, a path otherwise', () => {
    assert.equal(matchGlob('*.ts', 'src/deep/a.ts'), true)
    assert.equal(matchGlob('src/*.ts', 'src/deep/a.ts'), false)
    assert.equal(matchGlob('src/*.ts', 'src/a.ts'), true)
    assert.equal(matchGlob('!*.md', 'src/a.ts'), true)
    assert.equal(matchGlob('!*.md', 'src/a.md'), false)
  })
})

describe('displayPath', () => {
  it('relativizes inside the workdir and keeps outside paths absolute', () => {
    assert.equal(displayPath('/ws/src/a.ts', '/ws'), 'src/a.ts')
    assert.equal(displayPath('/ws', '/ws'), '.')
    assert.equal(displayPath('/other/a.ts', '/ws'), '/other/a.ts')
    assert.equal(displayPath('/ws-sibling/a.ts', '/ws'), '/ws-sibling/a.ts')
  })
})

describe('retention', () => {
  const matches = [1, 2, 3].map(index => ({ path: '/ws/a.txt', lineNumber: index, line: `line ${index}` }))

  it('matches the host suite\u2019s own ItemRetainer outcome', () => {
    const reference = new ItemRetainer({ kind: 'head', maxItems: 2 })
    for (const match of matches) reference.push(match)
    const expected = reference.finish()
    const actual = retainMatches(matches, 2, 2000)
    assert.deepEqual(actual, expected)

    const whole = new ItemRetainer({ kind: 'head', maxItems: 5 })
    for (const match of matches) whole.push(match)
    assert.deepEqual(retainMatches(matches, 5, 2000), whole.finish())
  })

  it('previews an over-long line inside the retention pass', () => {
    const retained = retainMatches([{ path: '/ws/a.txt', lineNumber: 1, line: 'x'.repeat(30) }], 250, 10)
    assert.equal(retained.items[0]?.line, 'xxxxxxxxxx (line truncated)')
  })

  it('caps a path list', () => {
    assert.deepEqual(retainPaths(['a', 'b', 'c'], 2), {
      items: ['a', 'b'],
      truncated: true,
      seen: 3,
      kept: 2,
      omitted: { kind: 'exact', count: 1 },
    })
    assert.deepEqual(retainPaths(['a'], 2).omitted, { kind: 'none' })
  })
})

describe('model-facing renderers', () => {
  const matches = [
    { path: 'src/a.ts', lineNumber: 3, line: 'one' },
    { path: 'src/a.ts', lineNumber: 9, line: 'two' },
    { path: 'lib/b.ts', lineNumber: 4, line: 'three' },
  ]

  it('renders grep exactly like the host suite when nothing is capped', () => {
    const caps = { maxMatches: 250, maxLineBytes: 2000 }
    assert.equal(renderGrepText(matches, caps), formatGrepOutput(retainMatches(matches, 250, 2000), undefined))
    assert.equal(renderGrepText(matches, caps).startsWith('Found 3 matches'), true)
  })

  it('renders grep exactly like the host suite when capped', () => {
    const caps = { maxMatches: 2, maxLineBytes: 2000 }
    const reference = formatGrepOutput(retainMatches(matches, 2, 2000), undefined)
    assert.equal(renderGrepText(matches, caps), reference)
    assert.equal(renderGrepText(matches, caps).startsWith('Found 2 of 3 matches'), true)
    assert.equal(renderGrepText(matches, caps).includes('The complete result could not be saved'), true)
  })

  it('words an empty grep result like the host suite', () => {
    assert.equal(renderGrepText([], { maxMatches: 250, maxLineBytes: 2000 }), 'No matches found')
  })

  it('renders glob exactly like the host suite in both cap modes', () => {
    const paths = ['a', 'b', 'c', 'd', 'e']
    const head = { maxResults: 3, sampleOverCapGlobResults: false }
    const sampled = { maxResults: 3, sampleOverCapGlobResults: true }
    assert.equal(renderGlobText(paths, head, '.'), `${['a', 'b', 'c'].join('\n')}\n\n(Showing 3 of 5 paths. The complete result could not be saved; narrow pattern or path to see more.)`)
    assert.equal(
      renderGlobText(paths, sampled, '.'),
      formatGlobOutput(sampleAcrossTopLevel(paths, 3, '.'), 5, undefined),
    )
    assert.equal(renderGlobText(paths.slice(0, 2), head, '.'), 'a\nb')
    assert.equal(renderGlobText([], head, '.'), 'No files found')
    assert.deepEqual(globCardPage(paths, head, '.'), { items: ['a', 'b', 'c'], truncated: true })
    assert.deepEqual(globCardPage(paths.slice(0, 2), head, '.'), { items: ['a', 'b'], truncated: false })
    assert.deepEqual(globCardPage(paths, sampled, '.'), { items: sampleAcrossTopLevel(paths, 3, '.').items, truncated: true })
  })
})

describe('search-card metadata', () => {
  const matches = [
    { path: 'src/a.ts', lineNumber: 3, line: 'one' },
    { path: 'src/a.ts', lineNumber: 9, line: 'two' },
    { path: 'lib/b.ts', lineNumber: 4, line: 'three' },
  ]

  it('narrows back into a search view through the host suite\u2019s own reader', () => {
    const meta = grepSearchMeta(retainMatches(matches, 250, 2000), 65536)
    const view = presentGrepResult({ pattern: 'x' }, { meta })
    assert.deepEqual(view, {
      card: 'search',
      shape: 'matches',
      files: [
        { path: 'src/a.ts', matches: [{ lineNumber: 3, line: 'one' }, { lineNumber: 9, line: 'two' }] },
        { path: 'lib/b.ts', matches: [{ lineNumber: 4, line: 'three' }] },
      ],
      truncated: false,
      total: 3,
    })
    assert.equal(presentGrepResult({ pattern: 'x' }, { meta: { shape: 'nope' } }), undefined)
  })

  it('projects a glob card the host suite\u2019s reader accepts', () => {
    const view = presentGlobResult({ pattern: 'x' }, { meta: globSearchMeta(retainPaths(['a', 'b'], 1), 65536) })
    assert.deepEqual(view, { card: 'search', shape: 'paths', paths: ['a'], truncated: true, total: 2 })
  })

  it('drops trailing groups to fit the metadata budget but never empties the card', () => {
    const long = { path: 'src/a.ts', lineNumber: 1, line: `${'x'.repeat(400)}` }
    const meta = grepSearchMeta(retainMatches([long, long, long], 250, 2000), 500)
    assert.equal(meta.truncated, true)
    assert.equal(meta.total, 3)
    assert.equal(meta.files.length, 1)
    const single = capMetaBytes({ shape: 'paths', paths: ['x'.repeat(500)], truncated: false, total: 1 }, 10)
    assert.equal(single.paths.length, 1, 'one oversized item survives rather than emptying the card')
  })
})

describe('target and argv resolution', () => {
  it('resolves a WSL UNC cwd into its distribution and Linux workdir', () => {
    const target = resolveTarget('\\\\wsl.localhost\\Ubuntu\\home\\mille\\ws', undefined)
    assert.equal(target?.distro, 'Ubuntu')
    assert.equal(target?.linuxCwd, '/home/mille/ws')
  })

  it('refuses a cwd that is not in a WSL world', () => {
    assert.equal(resolveTarget('C:\\Users\\mille\\ws', undefined), undefined)
    assert.equal(resolveTarget(undefined, undefined), undefined)
    assert.equal(resolveTarget('', undefined), undefined)
  })

  it('uses the configured or default distribution for a Linux-absolute cwd', () => {
    const configured = resolveTarget('/home/mille/ws', 'Debian')
    assert.equal(configured?.distro, 'Debian')
    assert.equal(configured?.linuxCwd, '/home/mille/ws')
  })

  it('maps a UNC target back to its Linux spelling', () => {
    assert.equal(linuxTarget('\\\\wsl.localhost\\Ubuntu\\home\\mille\\ws'), '/home/mille/ws')
    assert.equal(linuxTarget('src'), 'src')
    assert.equal(linuxTarget(undefined), '')
  })

  it('passes every model value as its own argv element after the fixed script', () => {
    const target = { distro: 'Ubuntu', linuxCwd: '/home/mille/ws', username: 'mille' }
    const script = 'set -u; exit 0'
    const values = ['a $(rm -rf /) b', '*.{ts,js}', '', '20000001']
    const argv = buildWslArgv(target, script, values)
    assert.deepEqual(argv.slice(0, 5), ['-d', 'Ubuntu', '-u', 'mille', '--cd'])
    assert.equal(argv[5], '/home/mille/ws')
    assert.deepEqual(argv.slice(6, 11), ['-e', 'bash', '-c', script, 'dsh'])
    assert.deepEqual(argv.slice(11), values)
    assert.equal(argv.includes('a $(rm -rf /) b'), true, 'the value stays one intact element')
  })

  it('omits the user flag when the workspace stores none', () => {
    assert.equal(buildWslArgv({ distro: 'Ubuntu', linuxCwd: '/ws' }, 'exit 0', []).includes('-u'), false)
  })
})

describe('apply', () => {
  /** A minimal registry stand-in. */
  function registry() {
    const tools = new Map()
    return { tools, get: name => name === 'tools' ? { register: tool => tools.set(tool.name, tool) } : name === 'spillStore' ? undefined : undefined }
  }

  it('registers exactly the grep and glob tools with WSL-honest descriptions', () => {
    const ctx = registry()
    apply(ctx, CONFIG)
    assert.deepEqual([...ctx.tools.keys()], ['grep', 'glob'])
    const grep = ctx.tools.get('grep')
    assert.deepEqual(grep.parameters.required, ['pattern'])
    assert.deepEqual(Object.keys(grep.parameters.properties), ['pattern', 'path', 'include'])
    assert.equal(grep.parameters.properties.pattern.description.includes('GNU grep -E'), true)
    assert.equal(grep.parameters.properties.include.description.includes('relative to the search root'), true)
    assert.equal(grep.description.includes('GNU grep extended regular expression'), true)
    assert.equal(grep.timeoutMs, CONFIG.timeoutMs)
    const glob = ctx.tools.get('glob')
    assert.deepEqual(glob.parameters.required, ['pattern'])
    assert.equal(glob.description.includes('oldest first'), true)
    assert.equal(typeof grep.presentCall, 'function')
    assert.deepEqual(grep.presentCall({ pattern: 'foo', path: 'src', include: '*.ts' }).title, 'Grep foo in src (*.ts)')
    assert.deepEqual(glob.presentCall({ pattern: '**/*.ts' }).title, 'Glob **/*.ts')
    assert.deepEqual(Object.keys(grep.output).sort(), ['presentationMeta', 'render', 'schema'])
  })

  it('does nothing when the tools registry is absent', () => {
    assert.doesNotThrow(() => apply({ get: () => undefined }, CONFIG))
  })

  it('mounts with schema defaults when the row carries no config at all', () => {
    // A world row with no `config:` block hands apply an undefined config; a real
    // session failed the whole world on exactly that (`Cannot read properties of
    // undefined (reading 'grepMaxMatches')`).
    const ctx = registry()
    assert.doesNotThrow(() => apply(ctx, undefined))
    assert.deepEqual([...ctx.tools.keys()], ['grep', 'glob'])
    assert.equal(ctx.tools.get('grep').timeoutMs, CONFIG.timeoutMs)
    assert.deepEqual(ctx.tools.get('grep').parameters.required, ['pattern'])
    const run = registry()
    apply(run, {})
    assert.deepEqual([...run.tools.keys()], ['grep', 'glob'])
  })
})
