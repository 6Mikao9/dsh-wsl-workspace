// The declared DSH releases are user-visible in three places: `package.json`
// (`dsh.compatibility.dshReleases`, which the help panel serves as chips) and
// the "Compatibility" section of the two full READMEs. Nothing kept them in
// step, so a release could be declared and never documented — or documented and
// never declared — without any check noticing.
//
// This also pins the repository URL the READMEs tell people to install from, so
// a rename cannot leave the install command pointing somewhere stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('package.json'));
const declared = Object.keys(manifest.dsh.compatibility.dshReleases).sort();

// A harness case copies the plugin's sources, not its prose (see
// `Prepare-Case.ps1`), so a tree without the READMEs skips these cases rather
// than reporting a missing file as a documentation defect.
const hasReadmes = fs.existsSync(new URL('../README.md', import.meta.url))
  && fs.existsSync(new URL('../README.zh.md', import.meta.url));
const skipWithoutReadmes = hasReadmes ? false : 'this copy of the plugin carries no READMEs'

/** The distinct backticked version tokens of a README's compatibility section. */
function readmeReleases(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `README is missing the "${heading}" section`);
  const rest = text.slice(start + heading.length + 2);
  const end = rest.indexOf('\n## ');
  const section = end === -1 ? rest : rest.slice(0, end);
  const tokens = [...section.matchAll(/`([^`]+)`/g)]
    .map(match => match[1])
    .filter(token => /^0\.\d+\.\d+/.test(token));
  // The prose may name a release more than once (e.g. to say which Desktop
  // build ships it); only the set of releases is the contract.
  return [...new Set(tokens)].sort();
}

test('every declared DSH release is listed in both full READMEs, and nothing else is', { skip: skipWithoutReadmes }, () => {
  assert.ok(declared.length > 0, 'the manifest declares no releases');
  for (const [file, heading] of [['README.md', '## Compatibility'], ['README.zh.md', '## 兼容性']]) {
    const listed = readmeReleases(read(file), heading);
    assert.deepEqual(listed, declared, `${file} does not match dsh.compatibility.dshReleases`);
  }
});

test('the READMEs and the manifest name the same repository', { skip: skipWithoutReadmes }, () => {
  const fromManifest = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(manifest.repository.url)?.[1];
  assert.ok(fromManifest !== undefined, `unparsable repository.url: ${manifest.repository.url}`);
  for (const file of ['README.md', 'README.zh.md']) {
    const text = read(file);
    assert.ok(
      text.includes(`https://github.com/${fromManifest}`),
      `${file} does not point at ${fromManifest}`,
    );
    assert.ok(
      !/github\.com\/6Mikao9\//.test(text),
      `${file} still points at the pre-move repository path`,
    );
  }
});

test('the shipped help panel points at the same repository', {
  skip: fs.existsSync(new URL('../src/client/locales.ts', import.meta.url))
    ? false
    : 'this copy of the plugin carries no client sources',
}, () => {
  const locales = read('src/client/locales.ts');
  const fromManifest = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(manifest.repository.url)?.[1];
  assert.ok(locales.includes(fromManifest), `locales.ts does not name ${fromManifest}`);
  const help = read('src/client/help.tsx');
  assert.ok(help.includes(`https://github.com/${fromManifest}`), 'help.tsx links elsewhere');
});
