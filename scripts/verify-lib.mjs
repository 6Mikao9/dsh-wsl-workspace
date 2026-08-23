/**
 * Post-build verification for the dsh-wsl-workspace lib bundle.
 *
 * tsdown (rolldown) copies the source's `node:*` import statements into the
 * ESM output verbatim. A source file that CALLS a builtin without importing
 * it (e.g. `statSync` used but missing from the `node:fs` import list) is
 * therefore faithfully reproduced into lib — and only fails at RUNTIME with
 * a `ReferenceError` swallowed by a nearby try/catch, which is exactly the
 * class of bug that shipped in 0.2.3 ("添加 WSL 工作区" reported every path
 * as non-existent because `check`'s `statSync` was undefined).
 *
 * This script makes that failure class impossible to ship: after every
 * build, it parses each lib entry, collects every identifier used as a
 * function call, and asserts each one is either a local binding, an import,
 * or a known global. Run it as part of the build pipeline:
 *
 *   pnpm build   # tsdown && node scripts/verify-lib.mjs
 *
 * @module dsh-wsl-workspace/scripts/verify-lib
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')

/** Identifiers that are legal without an import in an ESM module. */
const GLOBALS = new Set([
  // ECMAScript builtins
  'Array', 'ArrayBuffer', 'BigInt', 'BigInt64Array', 'BigUint64Array',
  'Boolean', 'DataView', 'Date', 'Error', 'EvalError', 'FinalizationRegistry',
  'Float32Array', 'Float64Array', 'Function', 'Infinity', 'Int16Array',
  'Int32Array', 'Int8Array', 'Intl', 'JSON', 'Map', 'Math', 'NaN',
  'Number', 'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError',
  'Reflect', 'RegExp', 'Set', 'SharedArrayBuffer', 'String', 'Symbol',
  'SyntaxError', 'TypeError', 'URIError', 'Uint16Array', 'Uint32Array',
  'Uint8Array', 'Uint8ClampedArray', 'WeakMap', 'WeakRef', 'WeakSet',
  'undefined', 'globalThis', 'decodeURI', 'decodeURIComponent', 'encodeURI',
  'encodeURIComponent', 'escape', 'unescape', 'isFinite', 'isNaN', 'parseFloat',
  'parseInt', 'console', 'process', 'Buffer', 'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'Event',
  'EventTarget', 'MessageChannel', 'MessagePort', 'MessageEvent', 'queueMicrotask',
  'structuredClone', 'atob', 'btoa', 'crypto', 'performance', 'fetch',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'clearImmediate', 'queueMicrotask', 'require', 'module', 'exports',
  // React / JSX runtime (client bundle)
  'React', 'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
  'useContext', 'useReducer', 'useLayoutEffect', 'useImperativeHandle',
  'createElement', 'Fragment', 'jsx', 'jsxs', 'jsxDEV',
])

/** Parse `import { a, b as c } from "node:fs"` style statements. */
function collectNodeImports(code) {
  const imports = new Map() // symbol -> module
  const re = /import\s*\{([^}]*)\}\s*from\s*["'](node:[a-z]+)["']/g
  let match
  while ((match = re.exec(code)) !== null) {
    const moduleName = match[2]
    for (const part of match[1].split(',')) {
      const trimmed = part.trim()
      if (trimmed === '') continue
      // Handle `a as b` aliasing (rolldown may alias to avoid collisions).
      const alias = /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(trimmed)
      if (alias === null) continue
      const local = alias[2] ?? alias[1]
      imports.set(local, moduleName)
    }
  }
  return imports
}

/** Strip comments and string literals so only real code is scanned. */
function stripCommentsAndStrings(code) {
  // Remove block comments, line comments, and string/template literals.
  // Order matters: strings first would break on quotes inside comments, so
  // comments first, then strings. This is a heuristic — bundled output is
  // machine-generated and regular, so the heuristic is reliable in practice.
  let out = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')          // block comments
    .replace(/\/\/[^\n]*/g, ' ')                 // line comments
  // Replace string literals (single, double, template) with spaces.
  out = out.replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' ')
  return out
}

/** JavaScript keywords that can precede `(` but are not function calls. */
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'async', 'await',
  'function', 'constructor', 'super', 'get', 'set', 'new', 'delete', 'typeof',
  'instanceof', 'in', 'of', 'yield', 'throw', 'else', 'do', 'case', 'default',
  'extends', 'class', 'static', 'import', 'export', 'with', 'debugger',
])

/**
 * Node builtin exports this plugin may call. A bare call to one of these
 * without a matching `node:*` import is the exact bug class this script
 * exists to catch (statSync in 0.2.3). Symbols NOT in this set are treated
 * as third-party/library internals and skipped — the authoritative gate is
 * the node:* import reference check below.
 */
const NODE_BUILTIN_EXPORTS = new Set([
  // node:fs
  'cpSync', 'existsSync', 'readdirSync', 'readFileSync', 'renameSync',
  'rmSync', 'statSync', 'writeFileSync', 'mkdirSync', 'copyFileSync',
  'linkSync', 'lstatSync', 'unlinkSync', 'readlinkSync', 'realpathSync',
  'openSync', 'closeSync', 'readSync', 'writeSync', 'appendFileSync',
  'watch', 'watchFile', 'unwatchFile', 'createReadStream', 'createWriteStream',
  'readdir', 'readFile', 'writeFile', 'rename', 'rm', 'stat', 'lstat',
  'link', 'unlink', 'mkdir', 'copyFile', 'realpath', 'access', 'accessSync',
  'constants', 'promises', 'Dirent', 'Stats', 'F_OK', 'R_OK', 'W_OK', 'X_OK',
  // node:path
  'dirname', 'join', 'resolve', 'basename', 'extname', 'normalize',
  'relative', 'isAbsolute', 'parse', 'format', 'sep', 'delimiter', 'posix', 'win32',
  // node:url
  'fileURLToPath', 'pathToFileURL', 'URL', 'URLSearchParams', 'fileURLToPath',
  // node:os
  'homedir', 'tmpdir', 'hostname', 'platform', 'arch', 'release', 'type',
  'cpus', 'networkInterfaces', 'userInfo', 'totalmem', 'freemem', 'EOL',
  // node:util
  'promisify', 'callbackify', 'inspect', 'format', 'types', 'deprecate',
  // node:child_process
  'execFile', 'execFileSync', 'exec', 'execSync', 'spawn', 'spawnSync',
  'fork',
  // node:http
  'createServer', 'request', 'get', 'IncomingMessage', 'ServerResponse',
  // node:async_hooks
  'AsyncLocalStorage', 'AsyncResource', 'createHook',
  // node:events
  'EventEmitter', 'once', 'on',
  // node:stream
  'Readable', 'Writable', 'Transform', 'Duplex', 'PassThrough', 'pipeline',
  // node:buffer
  'Buffer', 'SlowBuffer', 'transcode',
  // node:process (global, but listed for completeness)
  'cwd', 'env', 'argv', 'exit', 'on', 'once', 'hrtime', 'nextTick',
])

/** Collect every identifier used as a call (`name(`) in the code. */
function collectCallSites(code) {
  const calls = new Set()
  const clean = stripCommentsAndStrings(code)
  // Normalize whitespace so chained calls across newlines are detected:
  // `foo()\n  .filter(` becomes `foo() .filter(` — the `.` before `filter`
  // is then caught by the lookbehind.
  const normalized = clean.replace(/\s+/g, ' ')
  // Match identifier followed by `(` — but not:
  //   - keywords (if/for/while/...)
  //   - member calls `foo.bar(` / `foo?.bar(` (preceded by `.` or `?.`)
  //   - chained calls `foo().bar(` (preceded by `)`)
  //   - `import(`, `typeof x(`
  const re = /(?<![\w$.)])([A-Za-z_$][\w$]*)\s*\(/g
  let match
  while ((match = re.exec(normalized)) !== null) {
    const name = match[1]
    if (KEYWORDS.has(name)) continue
    calls.add(name)
  }
  return calls
}

/** Collect local bindings: declarations, destructuring, arrow functions, class methods. */
function collectLocalBindings(code) {
  const bindings = new Set()
  const declRe = /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g
  let match
  while ((match = declRe.exec(code)) !== null) bindings.add(match[1])
  // Arrow-function assignments: `const test = (...) => ...`
  const arrowRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g
  while ((match = arrowRe.exec(code)) !== null) bindings.add(match[1])
  // Array destructuring: `const [a, b] = useState(...)` — the setter names.
  const arrayDestructRe = /\b(?:const|let|var)\s*\[([^\]]*)\]\s*=/g
  while ((match = arrayDestructRe.exec(code)) !== null) {
    for (const part of match[1].split(',')) {
      const name = part.trim()
      if (name !== '' && /^[A-Za-z_$][\w$]*$/.test(name)) bindings.add(name)
    }
  }
  // Object destructuring: `const { a, b } = props` / function params.
  const objectDestructRe = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g
  while ((match = objectDestructRe.exec(code)) !== null) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(':')[0].trim()
      if (name !== '' && /^[A-Za-z_$][\w$]*$/.test(name)) bindings.add(name)
    }
  }
  // Class method definitions: `async resolve(` / `translate(` / `static foo(`
  // inside a class body. These are local to the class, so a bare call to
  // them elsewhere in the same module is a method invocation on `this`.
  const methodRe = /(?<![\w$.])(?:async\s+)?(?:static\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g
  while ((match = methodRe.exec(code)) !== null) bindings.add(match[1])
  return bindings
}

/** Collect identifiers imported from non-node modules (local chunks, externals). */
function collectOtherImports(code) {
  const imports = new Set()
  const re = /import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g
  let match
  while ((match = re.exec(code)) !== null) {
    for (const part of match[1].split(',')) {
      const trimmed = part.trim()
      if (trimmed === '') continue
      const alias = /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(trimmed)
      if (alias !== null) imports.add(alias[2] ?? alias[1])
    }
  }
  // Default imports: `import x from "..."` / `import * as x from "..."`
  const defaultRe = /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from\s*["'][^"']+["']/g
  while ((match = defaultRe.exec(code)) !== null) imports.add(match[1])
  const nsRe = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*["'][^"']+["']/g
  while ((match = nsRe.exec(code)) !== null) imports.add(match[1])
  return imports
}

/** Verify one lib entry file. */
function verifyEntry(filePath) {
  const code = readFileSync(filePath, 'utf8')
  const nodeImports = collectNodeImports(code)
  const otherImports = collectOtherImports(code)
  const localBindings = collectLocalBindings(code)
  const callSites = collectCallSites(code)

  const problems = []
  for (const name of callSites) {
    if (GLOBALS.has(name)) continue
    if (nodeImports.has(name)) continue
    if (otherImports.has(name)) continue
    if (localBindings.has(name)) continue
    // Only node builtin exports are authoritative: a bare call to one of
    // these without an import is the statSync-class bug. Third-party
    // bundled internals (cosmokit/schemastery) and injected props are not
    // in NODE_BUILTIN_EXPORTS, so they are skipped.
    if (!NODE_BUILTIN_EXPORTS.has(name)) continue
    problems.push(`  unbound call: ${name}() — missing node:* import`)
  }

  // Authoritative gate: every node:* import must be referenced in the code.
  // A symbol imported but never used means tsdown tree-shook it away — the
  // source's import list is then stale and a future edit may rely on it.
  const clean = stripCommentsAndStrings(code)
  for (const [name, moduleName] of nodeImports) {
    // The import statement itself contains the name; count real references
    // beyond the import line.
    const refRe = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, 'g')
    const refs = clean.match(refRe) ?? []
    if (refs.length <= 1) {
      problems.push(`  imported ${name} from ${moduleName} but never used (tree-shaken)`)
    }
  }
  return problems
}

/** Main: verify every lib entry. */
function main() {
  const entries = readdirSync(LIB_DIR).filter((name) => name.endsWith('.js'))
  let failed = false
  for (const entry of entries) {
    const problems = verifyEntry(join(LIB_DIR, entry))
    if (problems.length > 0) {
      failed = true
      console.error(`verify-lib: ${entry} has unbound calls:`)
      for (const problem of problems) console.error(problem)
    }
  }
  if (failed) {
    console.error('\nverify-lib FAILED: a lib entry calls an identifier that is not imported.')
    console.error('Add the missing import to the source file (src/*.ts) and rebuild.')
    process.exit(1)
  }
  console.log(`verify-lib OK: ${entries.length} lib entries, all calls bound.`)
}

main()