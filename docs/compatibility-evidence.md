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