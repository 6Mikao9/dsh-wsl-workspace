# DSH release compatibility evidence

The `dsh.compatibility.dshReleases` records in `package.json` are backed by the
reproducible procedure in `scripts/verify-dsh-compat.sh`. Re-run it before
changing any declaration:

scripts/verify-dsh-compat.sh 0.1.0-rc.7 0.1.0-rc.8 0.1.1-rc.1 0.1.1-rc.2 0.1.2-rc.1
## Method

For every declared release the script:

1. installs the published `@deepseek-ai/dsh@<version>` into an isolated temp
   prefix (never the live installation);
2. redirects `DSH_HOME` to a fresh temp tree and picks an unused port, so the
   live profile and the running harness are untouched;
3. runs `dsh plugin --profile web add dsh-wsl-workspace` (the normal user
   install path);
4. boots `dsh web --port <port>`, requires the web UI to serve, the plugin's
   `POST /wsl-workspace/api` to answer `200`, and the boot log to be free of
   plugin errors;
5. runs `dsh plugin --profile web remove dsh-wsl-workspace`, boots again, and
   requires the plugin route to be gone (clean uninstall).

A release is declared `compatible` only when install, start, and uninstall all
hold. Any failure would be declared `unknown` together with the failing step.

## Results (2026-09-03, plugin 0.4.1, Windows 11 + WSL2 Ubuntu)
| DSH release | install | start (route 200, no plugin errors) | uninstall (route gone) | verdict |
|---|---|---|---|---|
| 0.1.0-rc.7 | ✔ | ✔ | ✔ (route 405) | compatible |
| 0.1.0-rc.8 | ✔ | ✔ | ✔ (route gone) | compatible |
| 0.1.1-rc.1 | ✔ | ✔ | ✔ | compatible |
| 0.1.1-rc.2 | ✔ | ✔ | ✔ | compatible |
| 0.1.2-rc.1 | ✔ | ✔ | ✔ | compatible |
All five boots produced logs without a single `dsh-wsl-workspace` error line;
the verification transcript (per-version `boot-with-plugin.log`,
`boot-without-plugin.log`, `plugin-add.log`, `plugin-remove.log`) is retained
in the runner's temp directory by the script and printed as a summary table of
`<version> PASS compatible` lines at the end.

## Follow-up verification (2026-09-10, plugin 0.4.2)

`0.1.3-alpha.1` is gone from the declaration: npm publishes no
`@deepseek-ai/dsh@0.1.3-alpha.1` (`npm view` answers 404), so that entry could
never be verified by the procedure above. The published `0.1.3-alpha.2` takes its
place; every other declared release is unchanged.

Each declared release was re-verified on the isolated-case harness
(`scripts/compatibility/`), which pins every `dsh-*` dependency of the target
release and installs the plugin with its peers resolved from that same runtime:

```powershell
& ./scripts/compatibility/Prepare-Case.ps1 -Version '<release>' -RunId '<id>' -Port <port>
& ./scripts/compatibility/Start-Case.ps1 -Manifest '<case>/runtime.json'
& ./scripts/compatibility/Run-Checks.ps1  -Manifest '<case>/runtime.json'
```

| DSH release | boot | `POST /wsl-workspace/api` | checks exit 0 | Create & open: workspace `sessionIds` | session variant |
|---|---|---|---|---|---|
| 0.1.0-rc.7 | ok | `listDistros` | 9/10 | non-empty | `wsl-standard` |
| 0.1.0-rc.8 | ok | `listDistros` | 9/10 | not exercised | - |
| 0.1.1-rc.1 | ok | `listDistros` | 9/10 | not exercised | - |
| 0.1.1-rc.2 | ok | `listDistros` | 9/10 | non-empty | `wsl-standard` |
| 0.1.2-rc.1 | ok | `listDistros` | 9/10 | non-empty | `wsl-standard` |
| 0.1.3-alpha.2 | ok | `listDistros` | 9/10 | non-empty | `wsl-standard` |

`typecheck` is the tenth check and the only non-zero one; it sits at its
pre-existing baseline (module resolution for peers that exist only inside a DSH
install, plus the older `src/fs.ts` / `src/host/wsl-skills.ts:294,366` /
`tests/*` findings, none of them on a line this plugin's changes touch).

Create & open is asserted server-side rather than from the dialog: the workspace
record must carry the new session id, and the session log must contain
`agent-preset/selected` with `wsl-standard`. On the base commit `0.1.2-rc.1` left
`sessionIds` empty here - the workspace was created, no session was opened, and
the dialog reported success, because the plugin had cached its `uiWorkspace`
lookup at apply time, before that service existed.

### Model turn on 0.1.2-rc.1 (real API, final build)

One turn in a WSL workspace holding `offbyone-skill` (UTF-8 BOM, body on the line
immediately after the closing `---`) and a no-BOM control:

- `skill {name: "offbyone-skill"}` delivered
  `<skill_instructions>\nOFFBYONE-MARKER-Z9Q7\nsecond line\n</skill_instructions>`
  - the body's first character is intact and the BOM is stripped;
- `bash uname -sr; pwd` answered `Linux 6.18.33.2-microsoft-standard-WSL2` and
  `/home/mille/fu-rc1`;
- `write` + `read` round-tripped `notes/probe.txt` as `WSL-WRITE-OK`, and an
  independent `stat` from inside the distribution reported `644 mille`.

### The published artifact (2026-09-10, plugin 0.4.2)

Every check above installs the plugin from the working tree. The artifact users
actually receive was verified on its own: `npm pack` was extracted into a fresh
case whose plugin payload is exactly the tarball's `files` set (`lib`, `src`,
`cordis.patch.yml`, `package.json`, READMEs, LICENSE, NOTICE, images - no
`tests/`, no `scripts/`), keeping only the harness's junctioned `node_modules`.

| step | result |
|---|---|
| all three fixes present in the packed `lib` | BOM strip, lazy session starter, fail-loud message |
| `dsh plugin --profile web add <tarball payload>` | ok |
| check suite on that payload | 9/10 (`skills-real`, `host-api` exit 0; `typecheck` at baseline) |
| browser Create & open on `0.1.2-rc.1` | workspace `sessionIds` non-empty, session `wsl-standard` |
| uninstall (`dsh plugin remove`, boot again) | ok, route gone (405) |

### Model turn on the legacy line (0.1.1-rc.2, final build)

The same prompt on the legacy service shape (`connection.api.agentPresets` +
`workspaces.startSession`) returned the same results: the `skill` tool delivered
`<skill_instructions>\nOFFBYONE-MARKER-Z9Q7\nsecond line\n</skill_instructions>`,
`bash uname -sr; pwd` answered `Linux 6.18.33.2-microsoft-standard-WSL2` and
`/home/mille/fu-legacy`, and `write` + `read` round-tripped `WSL-WRITE-OK` with
an in-distribution `stat` of `644 mille`.

## Persona-format change and the dialog help panel (2026-09-11, plugin 0.4.3)

### The defect (issue #22)

`dsh-persona` moved its model-facing scalar in `0.1.3-alpha.2`: `text` became an
inline `suffix` plus a folded `prefix`. `appendablePersona()` matched `text: >-`
only, so from that release on the variant generator appended nothing and the
model was never told its working directory was a Linux path - silently, with the
WSL execution world itself unaffected (`bash`, the file tools and the skills all
kept working, which is why no earlier check noticed).

The generated preset proves it, and needs no boot: an isolated case keeps
`.agent-presets/<variant>/agent.cordis.yml`.

| DSH release | generated persona shape | WSL sentence before 0.4.3 | after 0.4.3 |
|---|---|---|---|
| 0.1.0-rc.7, 0.1.0-rc.8, 0.1.1-rc.1, 0.1.1-rc.2, 0.1.2-rc.1 | `text: >-` | present | present, byte-identical to the previous build |
| 0.1.3-alpha.2 | `suffix:` + `prefix: >-` | **missing** | present |
| 0.1.5-rc.1, 0.1.5-rc.2 | `suffix:` + `prefix: >-` | **missing** | present |

End-to-end on `0.1.5-rc.2`: the session log carries a `system/message` event
whose text includes `is inside a WSL (Windows Subsystem for Linux) distribution:
the bash tool and the file read/write/edit tools use Linux paths`.

### Full matrix with the final build

| DSH release | boot | `POST /wsl-workspace/api` | checks exit 0 | generated persona |
|---|---|---|---|---|
| 0.1.0-rc.7 | ok | `listDistros` | 9/10 | amended |
| 0.1.0-rc.8 | ok | `listDistros` | 9/10 | amended |
| 0.1.1-rc.1 | ok | `listDistros` | 9/10 | amended |
| 0.1.1-rc.2 | ok | `listDistros` | 9/10 | amended |
| 0.1.2-rc.1 | ok | `listDistros` | 9/10 | amended |
| 0.1.3-alpha.2 | ok | `listDistros` | 9/10 | amended |
| 0.1.5-rc.1 | ok | `listDistros` | 9/10 | amended |
| 0.1.5-rc.2 | ok | `listDistros` | 9/10 | amended |

`typecheck` is again the only non-zero check, at its pre-existing baseline.
Only `typecheck` failed anywhere: no `unit`, `lib`, `materialize`, `rank`,
`smoke-*`, `shell-extra`, `skills-real` or `host-api` regression on any release.

### The two gates that let it through

- `tests/host-materialize.mjs` drove only the legacy `text` shape, so the
  matcher looked correct. It now also drives a source preset in the new shape
  and one that opts out with `complete: true`, and asserts the sentence lands in
  the `suffix` rather than the `prefix`.
- `verify-lib`'s comment/string stripper could pair a lone apostrophe inside a
  comment with a later one and swallow the rest of the bundle; every `node:*`
  import then looked tree-shaken. Its quote rules now stop at a newline, as a
  JavaScript string does, so an innocent comment edit can no longer fail it.

### Dialog help panel

The W dialog gained a "?" button: the panel shows the plugin version and the
declared release matrix, read from the package's own `package.json` through the
host `describe` method (so the list cannot drift from the manifest), plus how the
plugin is used, what it does, and the limitations it cannot fix. Verified in the
browser on both client API lines - `0.1.5-rc.2` (current) and `0.1.1-rc.2`
(legacy): the panel opens and closes in place, renders the version line, the
release chips and three sections, and fits the card without overflow.

### The skill catalog over a UNC workspace

A session registered at `\\wsl.localhost\...` received **no** skill catalog: the
host's `dsh-skill-filesystem` starts a `chokidar` watcher on the workspace, that
watcher fails on the 9P share, the observation is reported with
`complete: false`, and `dsh-tool-skill` withholds the whole catalog line while a
snapshot is incomplete (`if (!snapshot.complete) return decision`). Since the
plugin controls the generated preset YAML, the fix needs no upstream change: the
materializer pins `watch: false` on the `skill-filesystem` row.

Evidence (2026-09-11, real model turns, browser, one case per client-API line):

| Probe | Before | After |
|---|---|---|
| generated `wsl-standard` row | `- id: skill-filesystem` (no config) | same row + `config:` / `watch: false` |
| generated `wsl-cordis` row | `config:` already held `customSkillDirs` | `watch: false` merged as the first child, `customSkillDirs` intact |
| model context, `0.1.5-rc.2` (current line) | no catalog | catalog injects the fixture skills |
| model answer, `0.1.5-rc.2` | no skills visible | names all three fixture skills |
| model answer, `0.1.1-rc.2` (legacy line) | *"There's no skill catalog shown in this context… I don't see an available skills list"* (the model's own reasoning, screenshot in the session at 19:06) | same case, workspace re-registered at 19:32: the prompt names the injection (`上下文注入 skill-catalog`) and the model answers *"共有 3 个 skill：browser4agent、offbyone-skill、tight-nobom"* |

The legacy-line session created after the fix was then driven through the whole
feature surface again (`0.1.1-rc.2`, `mtx3-cat`): `write` →
`/home/mille/mtx3-cat/notes/probe2.txt`, `read` back `WSL-WRITE-OK-112`, bash
`uname -sr` → `Linux 6.18.33.2-microsoft-standard-WSL2`, `pwd` →
`/home/mille/mtx3-cat`, `stat -c '%a %U %n'` → `644 mille notes/probe2.txt`, and
`skill offbyone-skill` delivered `<skill_instructions>\nOFFBYONE-MARKER-Z9Q7\n…`
with the body's first character intact.

`watch: false` is also the documented shape in the host schema
(`watch: z.boolean().default(true)`), and it is accepted on all eight declared
releases. A source preset that sets `watch` itself is left untouched. Regressions
are locked by three unit tests plus a `skill-filesystem` row in both
`tests/host-materialize.mjs` fixtures (with and without a pre-existing `config:`
block).

Why `watch: false` is the right key, read off the host source rather than guessed:

- `list()` flips `complete` to `false` **only** when `watchManager.observeRoots()`
  throws; every other path returns a plain candidate array.
- `observeRoots()` → `retainRoot()` calls `ensureWatcher()` only
  `if (this.config.enabled)`, and `resolveWatchConfig` computes
  `enabled: config.watch ?? true`.
- So with `watch: false` no watcher is ever opened, nothing throws, `complete`
  stays `true` and the catalog is injected. The `unhealthy` flag that starts as
  `true` is only ever consulted by watcher management, never by completeness.

The provider bundle is byte-identical on every declared release —
`@deepseek-ai/dsh-skill-filesystem/lib/index.js`, sha256 `1AEA87781BA5B4D4…`,
29591 bytes, the same in all eight case runtimes — so the behaviour above holds
wherever the plugin is installed, not just on `0.1.5-rc.2`.

Every declared release was then re-gated with this build: each case was
restarted (which regenerates its presets), the ten checks were re-run, and the
generated variants inspected. `typecheck` is the only non-zero check on all
eight (its pre-existing baseline); every case's `wsl-standard`, `wsl-cordis`
(and the `0.1.0` line's `wsl-code`, the `0.1.5` line's `wsl-ptc`) row carries
`watch: false`, and no variant is left with the watcher enabled.
