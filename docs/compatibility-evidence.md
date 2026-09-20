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

### Final-build browser pass (2026-09-11)

The multi-release browser matrix above was captured before the skill-watch fix,
and the two real-model catalog proofs above ran on an intermediate build, so the
shipped tree was put through the browser once more. Each target was verified to
run a `lib/client.js` byte-identical to the extracted tarball
(`sha256 D99E6B11DB304F2C…`), so this pass covers exactly the bytes that would be
published:

| Target | Build | Dialog + help panel | Create & open | Real model turn |
|---|---|---|---|---|
| `0.1.5-rc.2` (current line) | **the packed `npm pack` tarball installed as the plugin payload** | 3 sections, 8 release chips, 4 known-issue bullets (incl. the 0.4.3 fix note), panel scrolls inside the card | workspace `mtx6-pub`, draft chip `WSL · Standard mode（标准模式）` | catalog names (`browser4agent`, `offbyone-skill`, `tight-nobom`); `write`→`read` `PUB-ARTIFACT-OK`; `Linux 6.18.33.2-microsoft-standard-WSL2`, `/home/mille/mtx6-pub`, `644 mille notes/pub.txt`; skill body `OFFBYONE-MARKER-Z9Q7` |
| `0.1.0-rc.7` (oldest declared) | final source build | same panel, same 8 chips / 4 bullets | workspace `mtx5-rc7`, WSL draft chip correct | catalog injection chip + the same three names; `RC7-OK`; `644 mille notes/rc7.txt`; skill body intact |
| `0.1.1-rc.2` (legacy client line) | final source build | same panel, same 8 chips / 4 bullets | workspace `mtx5-rc112`, WSL draft chip correct | visible `skill-catalog` injection + the same three names; `LEGACY-OK`; `644 mille notes/legacy.txt`; skill body intact |

Scope of this pass, stated exactly: the three targets above were driven through
the browser on the final build; the remaining five declared releases were
re-gated (ten checks, generated-preset inspection) on the same build without a
browser pass. Between that browser pass and the published bytes the only
difference is the help panel's known-issue wording, which the `0.1.5-rc.2` target
(the packed artifact) exercises directly.


## Copied-variant world duplication (2026-09-19, plugin 0.4.4)

### The defect
The variant generator recognises its own output by id prefix (`isWslVariantId`), and
`transformPresetForWsl` appended its world group unconditionally. A user preset that
began as a copy of a generated variant (`wsl-standard` renamed to a custom "data
mode", carrying the old world group with whatever install path it was copied from)
was therefore processed as a plain source preset and received a **second**
`wsl-world` row. DSH refuses such a composition, so the mode could not be entered
at all.

Reproduced on `0.1.5-rc.2` with both builds, source preset = a copy of the generated
`wsl-standard`:

| build | generated rows | runtime |
|---|---|---|
| 0.4.3 (`main`) | `wsl-world` x2 | picker: `duplicate loader entry id: wsl-world` |
| #24 (`6e8558a`) | `wsl-world` x2 | picker: `duplicate loader entry id: wsl-world` |
| 0.4.4 (this fix) | `wsl-world` x1, this install's paths | mode selected; session mounted; real model answered and `pwd` = `/home/mille/fixworld-rc215` |

### The fix
The world group is now *replaced* rather than appended: the row is matched by the
provider ids it mounts (`shell-wsl` / `fs-wsl`), so a copy whose group was renamed is
still recognised, and a top-level row id repeated in a source is reduced to its first
occurrence (DSH rejects the whole preset on a duplicate id). `tool-str-replace-editor`
joined `WORLD_ROWS` like its `str-replace-editor` predecessor, and the variant's
display name is unquoted before it is re-emitted.

`tool-cordis` was deliberately **not** disabled: a `disabled` row never applies, which
removed `cordis_inspect_list` / `cordis_inspect_query` from the WSL variant of Creator
mode (0.4.3 answers with host `Service`/`Event`/`Builtin`/`Tool` plus five client
providers; the 0.4.4 build answers identically).

### Gates run
- Transform invariants over every shipped preset of the 17 installed runtimes, both
  builds: **136 transforms, 0 failures**, and **68/68** simulated copied-variant
  sources resolving to a single fresh world group with no stale install path.
- Ten-check harness on all eight declared releases (`0.1.0-rc.7` … `0.1.5-rc.2`):
  8/10 each — only the documented `typecheck` baseline and `host-api` (which requires
  a live server) fail, matching the 0.4.3 baseline.
- Browser + real model (`DeepSeek-V41-Flash`, `0.1.5-rc.2`): the copied-variant mode
  switches, mounts and answers (`pwd` = `/home/mille/fixworld-rc215`); Creator mode
  still exposes `cordis_inspect_list`.
- Browser + real model (`DeepSeek-V4-Flash`, `0.1.0-rc.7`, oldest declared): dialog →
  `WSL · Standard mode`, skill-catalog injection with 3 names, `write`→`read`
  `FIXWORLD-RC7-OK`, `644 mille`, `6.18.33.2-microsoft-standard-WSL2`.
## Per-mode matrix and help-panel pass (2026-09-19, plugin 0.4.4)

Every WSL variant was driven on four releases with a real model, asking for the
three capabilities that matter in a WSL workspace: a file written with the file
tool, a bash command executed inside the distribution whose output is redirected
into the workspace, and the file read back.

| release | modes | evidence left in `/home/mille/<ws>/notes/` | loader errors |
|---|---|---|---|
| `0.1.0-rc.7` (oldest declared) | Standard, PTC, Minimal, Creator | `MODE-<mode>-OK` plus `uname -r` = `6.18.33.2-microsoft-standard-WSL2`, `pwd` = the Linux workspace, `whoami` = `mille` | 0 |
| `0.1.1-rc.2` (legacy client line) | same four | same | 0 |
| `0.1.3-alpha.2` (persona split) | same four | same | 0 |
| `0.1.5-rc.2` (current line) | same four | same | 0 |
| `0.1.2-rc.1`, `0.1.5-rc.1` | same four | mode selected and a real turn answered (no file/bash assertions) | 0 |

In every mode the follow-up bash call lands back in the workspace, i.e. the shell
is per call: the source PTY group stays dropped, because it double-registers
`bash` and its win32 backend cannot spawn a terminal.

Help panel, verified in the browser on `0.1.5-rc.2`: the greeting line and the
repository link render first, a "What's new" section carries this release, and the
known-issue list is down to the two limitations that still hold — the historical
"fixed in 0.4.3" note, the per-generation API paragraph and the "only
plugin-registered workspaces default to a WSL variant" note are gone.

Both remaining limitations were re-checked and kept on purpose, and neither is a
dead end:

- **Linux symlinks are not resolvable over the share.** The discovery walk is this
  plugin's own provider, and its symlink branch (`src/host/wsl-skills.ts`:
  `entry.isSymbolicLink()` → `io.stat(joinUnc(...))`) already tries to follow a
  linked directory; it gives up only because 9P answers `EISDIR`/`ENOENT` for
  those entries. A `wsl.exe -d <distro> -- readlink -f <linux path>` fallback on
  that branch — the plugin already owns the UNC↔Linux helpers and the WSL
  execution channel — resolves the target and lets the walk continue. That is a
  new feature (loop/depth accounting, real-path dedupe, one WSL round-trip per
  candidate link, cross-release re-testing), not a one-line fix; the file tools
  would need the same fallback inside `WslFileSystem`'s resolution, which is a
  larger change. **Done for the scan in 0.4.5** (see the next section); the file
  tools are still open, and the panel now says exactly that.
- **No live catalog refresh** for UNC workspaces: the deliberate trade-off behind
  the catalog fix, as the panel says.

## Skill-scan symlink fallback (2026-09-19, plugin 0.4.5)

### The defect

A project linked into a workspace with `ln -s` was invisible to the skill
catalog — not a crash, a silent skip. Reproduced on the real share before the
fix (`node .test-runs/symlink/probe.mjs`, workspace `/home/mille/symprobe/ws`):

```text
linked-project   dir=false link=true stat: THROWS ENOENT
chain-a          dir=false link=true stat: THROWS ENOENT
notes-link       dir=false link=true stat: THROWS ENOENT
broken           dir=false link=true stat: THROWS ENOENT
```

`readdir` reports the entry as a symlink (`S_IFLNK`), and every Windows-side
`stat` on it fails, so the walk's follow branch never fires. The distribution
resolves the same paths trivially: `wsl.exe -d Ubuntu -- readlink -f /home/mille/symprobe/ws/chain-b`
→ `/home/mille/symprobe/deep/target`.

### The fix

`WslSkillIo` gained an optional `resolveLinks(uncPaths)` face; the production
face (`nodeSkillIo`) asks the distribution, and `discoverSkillRoots` collects the
symlink entries the share could not follow in each BFS layer, resolves them, and
pushes the **real** path into the frontier. Consequences that were checked, not
assumed:

- the walk continues where this share can actually read, so `readdir`/`stat`/
  `get()` all work again below a link;
- a project reachable both directly and through a link collapses onto one visit
  (the resolved path is the visited key, and the `(name, body)` fingerprint
  dedupe still backs it up);
- a link pointing back at the workspace root is absorbed by the visited set;
- a link to a file, and a link the distribution cannot resolve (dangling,
  missing intermediate component) are skipped exactly as before;
- a substrate that follows links itself never triggers a distribution call, and
  neither does a workspace without links (asserted, not observed).

Bounds: at most 32 links per lookup, four `wsl.exe` calls in flight, 10 s per
call, and the pre-existing depth / visited-directory / skill-directory budgets
are unchanged. One process per link is deliberate — see below.

### Why not one batched call

Measured against this WSL build (`wsl.exe` 2.7.10.0, Ubuntu):

| shape | result |
|---|---|
| `sh -c 'echo ARGC:$# ARG1:$1' sh a b c` | `ARGC:0 ARG1:` — arguments after the command are dropped |
| `sh -c 'for p in "$@"; do readlink -f "$p"; done' sh /path` | loop never sees the path (same cause) |
| any `sh -c` script containing a `"` | truncated at that quote by `wsl.exe`'s parser, silently |
| `readlink -f good missing/component good` | prints the first line and exits 1 — the rest of the batch is lost |
| `readlink -f '/path with spaces' "/path/with'quote"` | correct: a process argument carries any path |
| 6 links, one call each, concurrency 1 | 656 ms |
| 6 links, one call each, concurrency 4 | 208 ms |
| 6 links in one batched `sh` call (quote-free script) | 111 ms |

The batched form is faster but needs shell quoting that survives a parser which
truncates on double quotes; a quote character in a directory name would either
break the batch or need escaping that the same parser rewrites. One short call
per link keeps the path a *process argument* — no quoting anywhere — and costs
about 35 ms warm. On the full fixture: 6 links resolved in 179 ms inside a
`list()`, and a link-free workspace scans in 12–20 ms without starting a
distribution process at all.

### Gates

- **Real 9P** (`scripts/compatibility/skills-real.mjs`, part of the ten-check
  harness): builds a workspace whose only path in is a symlink to a second
  fixture **outside** the scan root, plus a nested project below the link target,
  a file link, a dangling link and a loop back to the root. Asserts the linked
  project and its nested project are published, that `get()` reads their bodies
  through the real path, and — in the same run — that the identical walk with the
  `resolveLinks` face removed finds neither. Passes.
- **Live WSL fixture** (`/home/mille/symprobe/ws`, `node .test-runs/symlink/probe.mjs`):
  catalog `["plain-skill","root-skill"]` before the fix → `["deep-skill","linked-skill",
  "nested-skill","plain-skill","root-skill"]` after it; `linked-skill` is served at
  `\\wsl.localhost\Ubuntu\home\mille\symprobe\elsewhere\linked-project\.dsh\skills\linked-skill\SKILL.md`
  (outside the workspace, i.e. only reachable through the link) and every body
  reads back.
- **Unit** (`tests/wsl-skills.test.ts`): seven new cases — linked-in project
  through the distribution, nested walk + no double publish, file/dangling links
  ignored, ancestor loop bounded, no distribution call when the share resolves
  links, per-lookup link budget, and no call at all in a link-free workspace.
  26/26 in the file, and the harness's `unit` check passes on every release.
- **Ten-check harness on the eight declared releases** (`0.1.0-rc.7` … `0.1.5-rc.2`,
  run `symlink-01`): 8/10 each, the same two documented baseline failures
  (`typecheck` exit 2 and `host-api`, which needs a live server). `skills-real`
  passes on all eight — the first run of `0.1.1-rc.1` failed because a manual
  fixture cleanup deleted `/tmp/dsh-wsl-compat` while that check was running; it
  passed when re-run, and `0.1.1-rc.2` passed immediately afterwards in the same
  sweep.
- **Real model on `0.1.5-rc.2`** (browser, `WSL · Standard mode`, workspace
  `/home/mille/symprobe/ws`): the model was asked to run `uname -r; pwd; whoami`
  in bash and redirect the output into the linked project, to write a marker with
  the file tool into the linked project's real path, and to list the skills it
  can see. It reported the catalog as `browser4agent`, `deep-skill`,
  `linked-skill`, `nested-skill`, `plain-skill`, `root-skill` — i.e. the three
  skills that are only reachable through a symlink (one of them through a chain)
  are in the injected catalog, interleaved with the host's own skills. On disk:
  `elsewhere/linked-project/notes/agent.txt` = `SKILL-LINK-OK` (file tool, real
  path outside the workspace) and `notes/bash.txt` =
  `6.18.33.2-microsoft-standard-WSL2` / `/home/mille/symprobe/ws` / `mille`
  (bash inside the distribution, redirect landed). The same session read the
  file back through `ws/linked-project/...` as well.

### Observation outside this change (not fixed here)

The same session probed the access mode and found it is **not enforced for the
file tools in a WSL session**. With the session on `workspace-write`
("工作区内修改"), `write` to `/home/mille/symprobe/policy-probe.txt` (outside the
workspace, no symlink involved) and to `D:\ProgramData\dsh-policy-probe.txt`
succeeded, with no denial — the second came back as
`/mnt/d/ProgramData/dsh-policy-probe.txt` created, and `read` confirmed its
content.

This is independent of the symlink change (no code touched by 0.4.5 is in that
path), and the mechanism is visible in the composition rather than guessed:

```
$ dsh --profile web --dump-config | grep -E 'sandbox|permission'
- id: sandbox            name: '@deepseek-ai/dsh-sandbox-local'
- id: sandbox-policy     name: '@deepseek-ai/dsh-sandbox-policy'
      mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
- id: fs-sandbox         name: '@deepseek-ai/dsh-fs-sandbox'
- id: permission         name: '@deepseek-ai/dsh-permission-presets'
```

The policy is host-plane and wraps the host `fs` service, while a WSL variant
mounts its own entry-local `fs` provider (`lib/fs.js`) inside the preset's
`isolate` realm and its `tool-fs` consumes that one, so the wrapper is not in the
call path. The variant shape is the same on every declared release (the transform
matrix asserts the injected world and its providers for all eight). The non-WSL
half of the statement — that those sessions keep the documented behaviour — rests
on that composition, not on a live probe: the attempt to start a control session
in a Windows workspace through the browser stalled on the workspace switcher.

Corrections that followed from the observation:

- `README.md` / `README.zh.md`, "File tools" behaviour note: no longer claims
  that `workspace-write` restricts writes in a WSL session; it states the measured
  behaviour, the mechanism, and that non-WSL sessions keep the documented one.
- Help panel known issues: a bullet says the access mode does not constrain a WSL
  session's file tools.
- `README.md` / `README.zh.md` also gained the missing **bash shell lifetime**
  note (one command per call, no persistent shell) — the limitation the per-mode
  matrix kept demonstrating while no document stated it. **Both of those
  limitations were then fixed**, and the 0.5.0 section below records that.

## WSL world parity (2026-09-19, plugin 0.5.0)

Four gaps between a WSL variant and the host closed in one release, each with the
mechanism it needed rather than a workaround:

| gap | mechanism |
|---|---|
| file tools could not read or write through a Linux symlink | `resolve`/`lstat` retry through the distribution (`wsl.exe … readlink -f`) whenever this share cannot describe the path, and continue at the real path |
| the access mode did not constrain a WSL session's file tools | `writeText`/`editText` fence exactly as `dsh-fs-sandbox` does: `ctx.sandboxPolicy`, `writableRoots` (plus the distro's `/tmp`), `FS_SANDBOX_DENIED`, `sandboxMode` |
| the skill catalog was frozen for the session | a per-scan-root change detector polls the published directory shape every 10 s and calls `control.invalidate()` |
| `bash` was one process per call | the world mounts the host's PTY registry + config-driven backend, pointed at this plugin's relay, which hands the PTY to `wsl.exe … bash` |

### What the browser pass caught that the unit checks could not

The generated preset looked right in every host-side check and failed three
different ways in a real session, which is why the session was driven at all:

1. `2 row(s) did not activate: terminal-wsl … waiting for terminals` — the world
   drops the source's `persistent-shell` group, and that group is what *provides*
   the `terminals` service. Fixed by mounting the world's own nested group
   (`isolate: terminals: true`) with the `pty` row.
2. `failed to apply loader entry persistent-bash … tool "bash" is already
   registered in this scope` — `@deepseek-ai/dsh-tool-bash-persistent` registers
   the tool name `bash`, not `persistent-bash`, so it can never sit beside the
   one-shot `dsh-tool-bash` row. Fixed by replacing that row (which is also what
   DSH's Minimal mode does, describing itself as a persistent-shell-only agent).
3. `GetNamedSecurityInfoW failed (Win32 1): \\wsl.localhost\…\ws` — the PTY
   backend confines through `ctx.sandbox` before spawning, and the host's Windows
   runner cannot read the ACL of a 9P path. Fixed by isolating the capability and
   providing the world's own no-op provider (`src/host/wsl-sandbox.ts`) that
   returns the caller's argv with `enforcement: 'partial'` — the policy stays
   where it is meaningful in this world (the file tools).

### Verification

- **Unit** — `tests/fs-policy.test.ts` (7 fence cases: inside/outside under
  `workspace-write`, `read-only`, `danger-full-access`, no policy service at all,
  edits, and the platform temp allowance), the three skill-refresh cases, and the
  three world-shape cases in `tests/variants.test.ts`. The harness's `unit` check
  runs them on every release.
- **Real 9P** — `scripts/compatibility/fs-real.mjs`: a link resolves to its real
  path, reads work through a link, a link chain and a directory link, a dangling
  link's target is created while the link survives, a write through a link
  reaches its target, the fence denies a link out of the workspace, and the
  distribution's `/tmp` is writable. `scripts/compatibility/relay-real.mjs`
  drives the relay itself: it starts in the session workspace, `export` and `cd`
  survive between sends, the distribution resolves from the UNC cwd and from
  `DSH_WSL_DISTRO`, `DSH_WSL_USER` is honored, and the shell exits cleanly.
- **Real session, `0.1.5-rc.2`, `WSL · Standard mode`, workspace
  `/home/mille/symprobe/ws`** (one session, four turns):
  - *persistent shell*: `export PERSIST_MARK=ok42; cd /tmp; pwd` → `/tmp`, then a
    separate call `echo MARK=$PERSIST_MARK; pwd` → `MARK=ok42` and `/tmp`;
  - *policy fence*: `write` to `/home/mille/symprobe/outside-probe.txt` (outside
    the workspace) came back as `[sandbox: file access denied under
    workspace-write mode]` plus DSH's escalation hint, and `ls` confirmed no file
    was created — i.e. the tool layer renders the world's `FS_SANDBOX_DENIED`
    exactly as it renders the host backend's;
  - *catalog*: the injected list carried the four symlink-only skills, and after a
    skill was created from WSL mid-session the next turn's list had exactly one
    more entry (`fresh-probe`), which the model itself described as the catalog
    refreshing while the session runs.
- **Twelve-check harness, all eight declared releases** (`0.1.0-rc.7` …
  `0.1.5-rc.2`, runs `parity-01` and `parity-02`): `unit`, `lib`, `materialize`,
  `rank`, `smoke-source`, `smoke-built`, `shell-extra`, `skills-real`, `fs-real`
  and `relay-real` pass; the only failures are the documented `typecheck`
  baseline (2) and `host-api`, which needs a live server. In `parity-01` the
  first six cases ran a stale `materialize` expectation (the source's
  persistent-shell group versus the world's own), which was fixed in the same
  commit and re-run green on all six; `parity-02` ran the final code everywhere.

## Search tools and a live catalog (2026-09-20, plugin 0.7.0)

The two remaining known issues from the 0.5.0 panel, closed with the mechanism
each needed:

| limitation | mechanism |
|---|---|
| a WSL session had no `grep`/`glob` tool | the world mounts its own twin (`src/host/wsl-search.ts` → `lib/wsl-search.js`) that runs **inside the distribution** — GNU `grep -rnIEH -Z` and GNU `find` — and keeps the host suite's model-facing contract by calling `@deepseek-ai/dsh-tool-fs-search`'s own exported formatters; the `tool-fs-search` row is replaced, and only for modes whose source preset mounted it |
| the catalog could not see an *edit* to an existing skill | the cheap poll (3 s) now also stamps every skill file with its modification time and size, so a rewritten `SKILL.md` moves the registry's revision — the catalog message is rebuilt only when that revision moves; the full re-discovery walk moved to its own 30 s cadence (it used to be the only pass, at 10 s) |

### What only a real substrate caught

Every one of these passed the host-side suite at some point:

1. **GNU grep silently cancels `--include` when any file `--exclude` is present**
   (grep 3.12): `--include=alpha.*` alone kept one file, and adding
   `--exclude='.*'` made it keep everything — measured, then designed around:
   the hidden-*file* guard now rides `--include='[!.]*'` and only when the caller
   passed no filter of its own, while hidden *directories* and `node_modules` are
   pruned with `--exclude-dir`, which does not disturb `--include`.
2. **`grep -r` prints no file name for a single-file operand**, so the NUL framing
   yielded `5:Body…` with no path and the tool returned zero matches for
   `grep path=<file>` — caught by `search-real`, fixed with `-H`.
3. **`--exclude-dir='.*'` also excludes the search root** when its base name
   starts with a dot, so a search rooted at `.dsh`/`.git`/any dot-directory
   returned nothing; the flag is now skipped for a dot-rooted target.
4. **A row without a `config:` block hands the plugin an undefined config.** The
   first real 0.6.0 session failed to mount the entire world:
   `failed to apply loader entry search-wsl … Cannot read properties of
   undefined (reading 'grepMaxMatches')`. Fixed with in-code defaults (one
   `DEFAULTS` object that the schema also reads) plus a unit test that mounts
   with `undefined` and with `{}`.
5. **`lib/` was shipping stale code-split chunks.** Because `clean: false` and two
   tsdown configurations share `outDir`, entries from earlier builds survived and
   `verify-lib` began reporting tree-shaken imports in `shell.js`. And because
   the search suite was not a declared peer, the first build *inlined* it: a
   285 KB `lib/wsl-search.js` that bundled a second copy of DSH's tool stack.
   Fixed by declaring the three runtime peers (which is also what keeps them
   external) and clearing `lib/` before every build.

### Verification

- **Thirteen-check harness, all eight declared releases** (`0.1.0-rc.7` …
  `0.1.5-rc.2`, run `parity-04`): `unit`, `lib`, `materialize`, `rank`,
  `smoke-source`, `smoke-built`, `shell-extra`, `skills-real`, `fs-real`,
  `relay-real` and the new `search-real` pass on every release; the only failures
  are the documented `typecheck` baseline (2) and `host-api`, which needs a live
  server. `search-real` drives the real tools against a real distribution
  fixture: record framing (colons, spaces, unicode, newlines in paths), include
  filters and `{a,b}` expansion, a path-shaped include, caps and footers, the
  spill backend present and absent, search-card projection, every `SEARCH_*`
  error code, argv-safety (a backtick pattern never reaches a shell), glob
  ordering by modification time, hidden/`node_modules`/VCS pruning and the
  in-tree-symlink rule.
- **Real sessions on three releases** — `0.1.0-rc.7`, `0.1.2-rc.1` and
  `0.1.5-rc.2`, each `WSL · Standard mode` on `/home/mille/wsprobe/ws`. Per
  release, from the session log: the offered `grep`/`glob` carry *this* plugin's
  descriptions (`tools=25/26/27 WSL-specific=glob,grep`); `grep
  NEEDLE_SESSION_TOKEN` returned 3 matches in 2 files with POSIX display paths
  and `node_modules` skipped; `glob **/*.js` returned 3 files *including*
  `node_modules` (ripgrep's `--no-ignore --hidden` parity). Then an existing
  skill's description was rewritten and a new skill added from WSL; the next
  turn's log carries a **replacement** catalog (`"update":true`) with
  `first-skill: EDITED mid-session on <release>` and
  `skill-<release>: ADDED mid-session on <release>` — and each model reported the
  diff itself. Before this release the edit could not move the revision at all.
- Unit tests: `tests/wsl-search.test.ts` (28 cases) checks the framing, the glob
  matcher, retention against `ItemRetainer`, byte-equality of both renderers with
  the host suite's own formatters, card metadata narrowed back through its
  `present*Result`, argv construction, and the config-less mount; the skill
  provider gained an edit-detection case and a cadence case (a brand-new skills
  directory waits for the walk), and `skills-real` proves on the real 9P share
  that a rewritten skill file invalidates exactly once.

### Still not fixed (now stated in the panel's known issues)

- `grep` is the distribution's GNU grep: POSIX ERE (no lookaround or
  backreferences) and no `.gitignore` support, so git-ignored files are searched;
  only hidden entries, `node_modules` and VCS directories are skipped. A
  distribution without GNU grep fails loudly (exit 3) instead of framing records
  the parser cannot read.
- An `include` containing `/` is matched in this process, so that call scans
  every file before filtering (a performance, not a semantic, difference).
- `glob`'s modification-order listing needs GNU `find -printf`; a busybox `find`
  falls back to path order, which the script reports as a different listing mode.
- The catalog refresh is still a poll: an add, remove or edit inside a published
  skills directory lands within about 3 s; a new project's *first* skills
  directory waits for the next walk, up to 30 s.

## Worst-case pass over the new code (2026-09-20, plugin 0.7.0)

A second sweep over what this release added — hunting inputs that could break it
rather than confirming the happy path — found six defects. Every one of them had
passed the host-side suite.

### Four in the search tools

| input | what happened | fix |
|---|---|---|
| `grep path=.env` | **zero matches** for a file the caller named: the hidden-file guard (`--include='[!.]*'`) applied to file targets too | the guard is added only when the target is a directory (the script tracks `dir`); a file the caller names is what it asked for |
| `glob path=/nope-missing` | `{root, paths: []}` with **no error** — `find`'s non-zero exit was swallowed by the pipeline, so an unreadable target looked like an empty directory | both scripts now `exit "${PIPESTATUS[0]}"`, and `acceptRun` treats exit 1 as success **only** for grep, where it means "searched, no match" |
| a search root whose name contains a newline | `root: "od"` and every returned path wrong — the header was `<mode> <root>\n`, so the newline split it | the header is NUL terminated (`G<root>\0`), like every record after it |
| `grep path='D:\proj'` | `SEARCH_FAILED … No such file or directory`, while `read D:\proj\a.ts` opens the same file | `linuxTarget` maps a drive path through the shared `windowsToMntPath`, so search and the file tools open one tree |

Two more came from reading the contracts rather than probing:

- **The spill schema was closed.** The canonical value is validated against
  `tool.output.schema` (`createSuccessResult` throws `ToolOutputError` on a
  violation), and `@deepseek-ai/dsh-spill`'s `SpillRef` is
  `{locator, bytes, retrievalHint}` — so `additionalProperties: false` on the
  `spill` field would have failed the tool's own result on *every capped search
  with a spill backend mounted*, exactly when the model needs the recovery path.
  The field is now open (extra fields belong to the backend) and `normalizeSpill`
  narrows it to the two fields the footer prints.
- **The catalog detector could stack polls.** A pass over a slow share can outlast
  the 3 s interval, and the interval callback was fire-and-forget, so walks would
  pile up on the 9P share and later polls could read a half-finished shape. One
  pass in flight per scan root now.

### Two in the shell — both the host's, both reported by the operator

1. **The host's wrapper and a trailing `&`.**
   `@deepseek-ai/dsh-tool-bash-persistent` wraps every command as
   `printf …START; eval -- $'…'; status=$?; printf …END`. A command ending in `&`
   backgrounds the *whole* eval'd command, so the END marker and its status are
   printed before the work runs: the call returns exit code 0 with no output, and
   the real output arrives later — it can land inside the next call's output
   window. Reproduced inside a real PTY with the host's own `wrapCommand`, which
   shows `__START__ / [1] 459 / __END__:0 / one` — the output arriving *after* the
   marker; the same harness shows the documented form (`( … ) &` on its own line)
   keeping the sequencing intact. **Every release from `0.1.0-rc.7` on carries the
   identical wrapper**, and the host's own Minimal preset recommends exactly the
   hazardous form (`sleep 10 &`). `description` is a supported config key on all
   eight releases, so the world now overrides it with both facts (state carries
   over across calls; background a subshell) plus the safe form. Confirmed in a
   real `0.1.0-rc.7` session: the model quoted the override verbatim.

2. **`0.1.0-rc.7` cannot run a PTY shell on Windows at all.** Its
   `@deepseek-ai/dsh-subprocess-local` builds a process inspector inside
   `spawnTerminal` and supports only `linux`/`darwin`, throwing
   `subprocess-local: terminal inspection is unsupported on platform win32`
   before any process starts. A real session on that release showed the model
   getting exactly that error for every `bash` call, while grep/glob — which never
   touch the PTY — kept working. The capability arrived in `0.1.0-rc.8`
   (`createWindowsProcessInspector`), which the host itself relies on: that
   release's Minimal preset mounts `persistent-bash` with no Windows guard, so the
   host ships the same gap.

   The plugin now **probes the substrate instead of assuming**: it hands
   `spawnTerminal` a program that cannot exist, which reaches the inspector check
   and nothing else — no process is created either way, and the rejection says
   which half failed (`isTerminalInspectionUnsupported`). When the answer is "no
   inspector", the world keeps the one-shot `dsh-tool-bash` row, which runs
   through this plugin's own `ctx.shell` and never touches the PTY.

   Verified per release by booting each prepared case and reading the generated
   preset: `0.1.0-rc.7` gets the one-shot row, `0.1.0-rc.8` and `0.1.5-rc.2` get
   the persistent group with the description override. A real session on
   `0.1.0-rc.7` then showed `pwd && echo BASH_OK && uname -s` returning
   `/home/mille/manualtest`, `BASH_OK`, `Linux` (exit 0) — previously every call
   failed — and a follow-up pair of calls confirming the fallback is stateless
   (`cd /tmp` in one call, `pwd` in the next → `/home/mille/manualtest`), which is
   what that tool's own description tells the model.

### Verification of the fixes

- 148 unit tests green, including the new cases pinning each defect: framing
  around a newline in a root, the explicit dot-file, the `/mnt` mapping, the spill
  schema shape, the description block, the poll-stacking guard, and the
  background-job producer's registry contract (start arguments, hook bridging,
  outcome mapping, and the config-less mount).
- `search-real` gained six regressions (explicit dot-file, unreadable root, root
  name with a newline, `/mnt` path, cooperative timeout → `SEARCH_ABORTED`,
  raw-output overflow) alongside the existing framing, include, cap, spill, card
  and argv-safety checks.
- Thirteen checks × eight declared releases re-run with the fixes, each 11/13 with
  only the two documented baselines. Booting each case confirms the shape per
  release: `0.1.0-rc.7` gets the one-shot row and no producer, `0.1.0-rc.8` and
  later get the persistent shell plus `bash_background`.

## The background-job producer (2026-09-20, plugin 0.7.0)

An operator's own session surfaced the last one, and it was this plugin's doing —
twice over.

**What they saw.** `bash` accepted `run_in_background: true`, ran the command in
the *foreground* (a `sleep 3` really took three seconds), returned its output
inline instead of a job id, and `job_list` answered `(no background jobs)` every
time.

**Why.** DSH's *one-shot* `dsh-tool-bash` is what starts a registry job:
`run_in_background: true` calls `ctx.jobs.start({kind: 'bash', …, run})` around a
`ctx.shell.start(...)` handle, and the host's `job_list`/`job_output`/`job_kill`
read that registry. A WSL world replaces that tool with the host's **persistent**
one, whose schema declares only `command` — so nothing produced a job. The
parameter schema does not set `additionalProperties: false` either, so the
unknown argument passed validation, was ignored by the tool, and no layer
reported it. The model had been *told* to use that parameter by this plugin's own
shell description, which mentioned `run_in_background: true` while describing how
to background work — a promise the tool it was attached to cannot keep.

**Fix, in two parts.**

1. The description now says what the tool is: `command` only, no
   `run_in_background` (and passing one is ignored), background a subshell as
   `( long-job > log 2>&1 ) &` and poll the log.
2. The world mounts `bash_background` (`src/host/wsl-jobs.ts` → `lib/wsl-jobs.js`),
   a thin producer over the host's own seams: `ctx.jobs.start` for identity and
   lifecycle, this plugin's `ctx.shell.start` for the process handle, and the
   registry's `JobHooks` for cancel/done/readOutput. It is mounted only alongside
   the persistent shell — a world that keeps the one-shot bash row already has
   `run_in_background` on that tool, so mounting both would be redundant.

**Verified in a real session** (`0.1.3-alpha.2`, WSL · Standard mode):

```
bash_background: started background job bash-1
job_list:        bash-1 [bash] running — for i in 1 2 3; do echo tick $i; sleep 1; done
job_output:      tick 1 / tick 2 / [status: running]
(4 s later)      tick 3 / [status: completed, exit code: 0]
```

The reads are incremental (the second read returned only the new line), the status
transitioned `running` → `completed`, and the runtime pushed its own completion
notice — the same behaviour the host's one-shot tool gives a non-WSL session.

**A second defect, caught by the same session.** The first attempt failed to mount
at all: `failed to apply loader entry jobs-wsl … Cannot read properties of
undefined (reading 'timeoutMs')` — a world row with no `config:` block hands a
function plugin an *undefined* config, which is the same mistake `wsl-search` made
one release earlier. Both entries now keep their defaults in one `DEFAULTS` object
the schema also reads, and both have a unit test that mounts with `undefined` and
with `{}`. That two entries made the identical mistake in one release is the
argument for the test rather than the convention.

**Two more, found by auditing the new tool before shipping it.**

- **A producer without a reader.** The world mounted `bash_background` whenever the
  persistent shell was mounted, but Minimal mode's source preset has no
  `tool-jobs` row — so a WSL Minimal session would have handed out job ids with no
  `job_output` or `job_kill` to read them. The row is now gated on the source
  mounting `tool-jobs`, the same `sawSearch`/`sawEditor` rule the other rows
  follow: a mode never gains a capability it did not have.
- **The job's working directory.** `bash_background` passed only the caller's
  `workdir`, so an omitted one fell through to this plugin's shell provider, whose
  fallback is its own configured cwd — in a WSL world, the *host process's*
  Windows directory, which the distribution cannot use. The persistent `bash`
  starts in the session workspace (the relay's `cd`), so the producer now defaults
  to the session cwd (`exec.agent.session.header.cwd`) and matches it. Verified in
  a real session: `bash_background` with no `workdir` reported
  `/home/mille/manualtest`, and `job_kill` on a long loop returned
  `[status: killed, exit code: 1]` with no further output.



