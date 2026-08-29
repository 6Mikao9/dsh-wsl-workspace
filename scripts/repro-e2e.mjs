// End-to-end verification of the WSL skills provider against the REAL
// \\wsl.localhost 9P share (requires WSL + the repro tree from repro-setup.sh).
//   node scripts/repro-e2e.mjs
// Override the target with WSL_DISTRO / WSL_USER / REPRO_ROOT environment
// variables when running as another user or distro.
import { WslSkillsProvider } from '../src/host/wsl-skills.ts'

const control = { signal: new AbortController().signal, invalidate: () => {} }
const provider = new WslSkillsProvider(control)

const distro = process.env.WSL_COMPAT_DISTRO ?? 'Ubuntu'
const user = process.env.WSL_COMPAT_USER ?? 'mille'
const rootPath = process.env.WSL_COMPAT_ROOT ?? `/home/${user}/repro-ws-root`
const workspaceRoot = `\\\\wsl.localhost\\${distro}\\${rootPath.replaceAll('/', '\\')}`
const nestedProject = `${workspaceRoot}\\proj-a`

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