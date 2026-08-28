// End-to-end verification of the WSL skills provider against the REAL
// \\wsl.localhost 9P share (requires WSL + the repro tree from repro-setup.sh).
//   node scripts/repro-e2e.mjs
import { WslSkillsProvider } from '../src/host/wsl-skills.ts'

const control = { signal: new AbortController().signal, invalidate: () => {} }
const provider = new WslSkillsProvider(control)

const workspaceRoot = '\\\\wsl.localhost\\Ubuntu\\home\\mille\\repro-ws-root'
const nestedProject = '\\\\wsl.localhost\\Ubuntu\\home\\mille\\repro-ws-root\\proj-a'

console.log('== provider.list with cwd = workspace root (the bug scenario) ==')
const fromRoot = await provider.list({ cwd: workspaceRoot })
console.log(fromRoot.map(s => `${s.name} [${s.source} rank=${s.rank}]`) ?? '(none)')

console.log('\n== provider.list with cwd = nested project (host-parity reference) ==')
const fromNested = await provider.list({ cwd: nestedProject })
console.log(fromNested.map(s => `${s.name} [${s.source} rank=${s.rank}]`) ?? '(none)')

console.log('\n== provider.get(body load) ==')
const first = fromRoot[0]
if (first !== undefined) {
  const def = await provider.get(first, { cwd: workspaceRoot })
  console.log(`${def.name}: ${JSON.stringify(def.content)}`)
}

console.log('\n== non-WSL cwd stays untouched ==')
console.log(await provider.list({ cwd: 'D:\\ProgramData\\dsh-wsl-workspace' }))