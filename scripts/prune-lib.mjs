// Remove unreferenced build artifacts from lib/. tsdown is configured with
// `clean: false` (the node and client builds share the outDir, so a clean
// would wipe the other build's output), which leaves the previous chunk set
// behind whenever a chunk's content hash changes. Shipping those stale
// chunks is dead weight at best and has repeatedly tripped releases
// (0.2.3 shipped an old inlined-schemastery chunk that dsh.so's static scan
// flagged). This script walks the import graph from the four entries and
// deletes every lib/*.js / *.js.map nothing references:
//   node scripts/prune-lib.mjs
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const libDir = join(dirname0(), 'lib')

function dirname0() {
  return new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
}

const ENTRIES = ['index.js', 'shell.js', 'fs.js', 'client.js']

function chunkImports(file) {
  const source = readFileSync(join(libDir, file), 'utf8')
  const specs = []
  for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["'](\.\/[^"']+\.js)["']/g)) {
    specs.push(match[1].slice(2))
  }
  return specs
}

const keep = new Set(ENTRIES)
const queue = [...ENTRIES]
while (queue.length > 0) {
  const file = queue.pop()
  if (file === undefined) break
  for (const spec of chunkImports(file)) {
    if (!keep.has(spec)) {
      keep.add(spec)
      queue.push(spec)
    }
  }
}

let removed = 0
for (const file of readdirSync(libDir)) {
  if (!file.endsWith('.js') && !file.endsWith('.js.map')) continue
  if (keep.has(file)) continue
  if (file.endsWith('.js.map') && keep.has(file.slice(0, -4))) continue
  rmSync(join(libDir, file))
  console.log(`prune-lib: removed unreferenced ${file}`)
  removed += 1
}
console.log(`prune-lib: ${keep.size} referenced entries kept, ${removed} stale files removed`)
if (removed > 0 && process.argv.includes('--strict')) process.exit(1)
