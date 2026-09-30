# Check catalog

Single inventory of every test, gate and manual pass in this repository, its
run command, its environment prerequisites, and where it lives in the
automation. CI wiring: `.github/workflows/ci.yml` (per PR/push) and
`.github/workflows/compat.yml` (rolling window, weekly/dispatch). Local and CI
run the same commands: the `npm run test:*` buckets below.

## A. Pure-node unit bucket — `npm run test:unit` (+ `npm run test:win32` on windows), no host packages needed

| Check | What it pins down | Prereq | CI home |
| --- | --- | --- | --- |
| `tests/variants.test.ts` | WSL preset-variant transform: row stripping, realm injection, exactly-once re-injection, unknown rows survive | node ≥ 24 | ci.yml#lint-build |
| `tests/paths.test.ts` | UNC↔Linux path conversion, `/mnt/<drive>` mapping, Windows-path keys, distro-username validation | node ≥ 24 | ci.yml#lint-build |
| `tests/locales.test.ts` | zh/en dictionary key parity, no empty values, help-panel body shape | node ≥ 24 | ci.yml#lint-build |
| `tests/wsl-skills.test.ts` | skill provider over an in-memory IO fake: nested discovery, ranks, frontmatter incl. block scalars, depth/budget, cache TTL, dir-symlink following | node ≥ 24 — **runs on the windows runner** (`npm run test:win32`, ci.yml#wsl-gate): expected UNC strings assume win32 `path.join`; on ubuntu the same provider code yields `/`-joined paths (first CI frame 2026-09-30, 2/84 failed there) | ci.yml#wsl-gate |
| `tests/relay-node.test.mjs` | v0.7.5 #40/#43: relay-interpreter resolution — Electron-host classification, candidate order, probe discriminator | node ≥ 24 — **runs on windows** (`npm run test:win32`): despite injected platform/exists callbacks, the candidate assembly joins Windows-shaped constants with the host-native `path`, so on ubuntu the strings differ (CI frame a37c3e3: 3 failures on ubuntu, green on windows) | ci.yml#wsl-gate |
| `tests/readme-compat.test.mjs` | v0.7.5: `dsh.compatibility.dshReleases` vs both full READMEs' Compatibility sections + the install-URL, so declaration and documentation cannot drift apart | node ≥ 24 | ci.yml#lint-build |
| `tests/wsl-output-decode.test.ts` | the `wsl.exe` output sniff (`src/shared/wsl.ts:102`): NUL bytes ⇒ UTF-16LE, none ⇒ UTF-8, empty ⇒ `''`, odd length ⇒ no throw, a non-buffer ⇒ a named error rather than a silent empty list. Also `wslExecutableCandidates` (the #36 PATH/System32 fallback) and `listDistros()` parsed from a **faked** child_process, so the UTF-16 branch is exercised with no distribution and no `wsl.exe` — `grep -rn utf16 tests/` used to find one hit, `exec-shape.mjs:42`, which needs both | node ≥ 24 | ci.yml#lint-build |
| `tests/client-classnames.test.ts` | no `className` in `src/client/` ships without a rule in `src/client/styles.ts` or a stated reason. There is no `.css` file in the tree (`find src -name '*.css'` → 0), so nothing else can see this pairing — an unstyled class renders with browser defaults and nobody notices. Who owes what is decided by **shape**: `block--state` of a block that is itself applied is a real state and must be registered with a ticket reference; a container name may be exempted with a reason. Mutation control run here: an unregistered `dww-night-unstyled-probe` → RED `unstyled classNames`; a `dww-help--night-probe` → RED `unstyled modifiers registered nowhere`; restore → GREEN. Currently registers `dww-action--wide` (no rule; wide and rail render identically) as a pending product item — issue #44 §6 | node ≥ 24 | ci.yml#lint-build |
| `tests/support/fake-child-process.test.mjs` | the fixture other checks lean on: a scripted answer must reach a **static ESM import** of `execFile` after `syncBuiltinESMExports()`, and must not reach it without `--import`. Positive control in both directions — the first version of this fixture patched at module-load time, so "armed" was true even in the run meant to prove the wrapper never ran, which is exactly the false green this whole pass is fixing. Also asserts an unmatched call becomes `FAKE_UNMATCHED` rather than a real spawn, and a killed run carries `signal` without a numeric `code` | node ≥ 24 | ci.yml#lint-build |
| `scripts/check-docs-parity.mjs` | documentation parity, split out of #42: each README must carry exactly the section **names** declared in the checker (v0.7.5 inserting `## Compatibility` is what killed positional checks), eight behaviour bullets, the tool tokens (`wsl-search`, `wsl-relay`, `bash_background`, `readlink`, `FS_SANDBOX_DENIED`), no claim the English authority dropped, no version range inside a changelog pointer, the manifest repository in all nine languages, every relative link in every `*.md` resolving, and `CHANGELOG.md` / `CHANGELOG.zh.md` agreeing on the release list with the newest entry equal to `package.json`'s version. Mutation control: `npm run test:docs -- --root <v0.7.5 tree>` reports 93 RED and exits 1 | node ≥ 24 — no host packages, no WSL, no network (`npm run test:docs`) | ci.yml#lint-build |

## B. Node buckets needing the pinned host packages — `npm run test:node`

The `@deepseek-ai/*` peers are optional and provided by the host at runtime;
in a clean checkout `node ci/install-pinned.mjs` materialises the pinned tree
(ci/pinned-deps.json → ci/deps) and links it in. `test:node` rebuilds `lib/`
first because the client/host integration checks consume built artifacts.

| Check | What it pins down | Extra prereq | CI home |
| --- | --- | --- | --- |
| `tests/shell.test.ts` | login-shell `cd` prefix keeps the workdir (quote escaping); non-login shells leave the command alone | cordis | ci.yml#runtime-tests |
| `tests/fs-execution-context.test.ts` | `WslFileSystem` inherits the session cwd through AsyncLocalStorage; falls back to the configured distro without an agent | cordis | ci.yml#runtime-tests |
| `tests/fs-policy.test.ts` | write fence across `workspace-write` / read-only / danger-full-access / no-policy, plus the symlink-resolution seam (creates `.fs-policy-*` dirs in cwd, cleans up in finally) | cordis; **runs on windows** (`npm run test:win32`, ci.yml#wsl-gate): the fixture derives the distro from the shape of `process.cwd()`, so a POSIX-shaped runner cwd yields "Linux path carries no distribution" (2/2 CI frame 2026-09-30) | ci.yml#wsl-gate |
| `tests/wsl-jobs.test.ts` | background-job producer (regression: `run_in_background` was silently ignored) | schemastery, dsh-tools | ci.yml#runtime-tests |
| `tests/wsl-search.test.ts` | grep/glob twins vs the host `dsh-tool-fs-search` exported pieces (framing, caps, footers) — drift detector | dsh-tool-fs-search, dsh-output-retention | ci.yml#runtime-tests |
| `tests/client-lifecycle.test.mjs` | the published `lib/client.js` in a vm sandbox against legacy + current runtime facades: preset binding, create & open, late-service registration | built lib | ci.yml#runtime-tests |
| `tests/host-materialize.mjs` | host `apply()` directory channel: generated rows reference real lib files, atomic publish, stale cleanup, legacy `wsl` removal | cordis, schemastery, js-yaml, built lib | ci.yml#runtime-tests |
| `tests/host-declare.mjs` | declaration channel (0.1.7+): capability switch, one declaration per healthy source, `!!js` round-trip, dispose retires all — must run paired with the check above | same | ci.yml#runtime-tests |
| `scripts/check-rank-parity.mjs` | PROJECT_\*\_RANK copies vs the host dsh-skill-filesystem lib. **Strict is now the default** — an unresolvable host package exits 1 saying `NOT VERIFIED`, because the old no-flag path printed a warning and exited 0, which made "nothing to compare" indistinguishable from "nothing drifted"; `--strict` is still accepted as a no-op and `--lenient` restores the old skip for a human. Sentinel: `--host <file with no rank constants>` → rc 1 `NOT VERIFIED … did not run`; `--host <file with PROJECT_DSH_RANK = 101>` → rc 1 drift; the real tree → rc 0 | pinned tree | ci.yml#runtime-tests |

| `tests/persistent-shell-fallback.mjs` | the probe's **false** branch, which the ubuntu `runtime-tests` runner could never reach: `src/index.ts:557` returns early when `process.platform !== 'win32'`, so today CI never executed the probe at all. Forces `platform='win32'`, drives the **built** `apply()` through the declaration channel, and asserts that a `subprocess` whose `spawnTerminal` rejects with the inspector message yields a WSL world with **no** `persistent-bash` / `terminal-wsl` / `backendType: wsl` / `sandbox-wsl` / `jobs-wsl` row while keeping the one-shot `tool-bash` and `shell-wsl`/`fs-wsl`/`search-wsl` — a WSL world without a PTY, not no world. Positive control: the same fixture with a working probe mounts `persistent-bash`; absent service mounts it and settles inside the bounded ~2 s `waitForSubprocess` poll. Mutation control run here: flip `subprocess?.spawnTerminal === void 0` to `!==` in `lib/index.js` → 8 failing, restore → `PERSISTENT SHELL FALLBACK PASSED`. Registered deviation: the ticket asked for `isTerminalInspectionUnsupported` to answer **false** for a `…on platform linux` message; the regex at `:583` stops at "on platform" and answers true (measured: linux true / win32 true / `spawn ENOENT` false) — the test pins the real behaviour, and whether the OS token should be inspected is an open product question, not this check's to decide | cordis, js-yaml, cordis-plugin-include, built lib | ci.yml#runtime-tests |

| `tests/route-envelope.mjs` | the **published** dialog route over a real `node:http` socket on `127.0.0.1:0` — the handler captured from `webServer.register` (`src/index.ts:864-896`), the seam `tests/host-materialize.mjs:223` used to discard. 74 labelled asserts: loopback fence on both halves including the DNS-rebinding `Host` class (driven with `node:http`, because `fetch` silently drops a caller-set `Host` — measured), POST-only, the 1 MiB body cap **at the byte boundary** (1048576 in, 1048577 out), `params` null/array/string never becoming a 500 or an empty body, `describe` answering at runtime the release list `package.json` declares (artifact↔manifest drift, which `readme-compat` cannot see), the cache/nosniff headers, `check`'s distro gate firing before any UNC is built, `setUser` refusing a non-UNC path with the registry store untouched, and — faked child_process — an unstartable `wsl.exe` reported as `{ok:false}` naming wsl.exe, never `{ok:true, value: []}` (#35/#36's visible shape). Mutation control run: delete `\|\| !isLoopbackHost(req.headers.host)` from `lib/index.js:1876` → 3 Host-fence asserts RED, restore → PASSED. Spec deviation pinned rather than faked: bad `params` answers **400** (`lib/index.js:1902-1908`), not the 200 the ticket assumed | pinned tree, built lib | ci.yml#runtime-tests |
| `tests/search-run-fakes.mjs` | the search executor's spawn contract, offline: 106 labelled asserts over the registered `grep`/`glob` tool's `execute` with `tests/support/fake-child-process.mjs` armed, one scenario per child process. Pins the recorded options object itself (`killSignal:'SIGKILL'`, caller's `timeout`, `encoding:'buffer'`, `windowsHide`, `signal` forwarded by identity when present and absent when not, `maxBuffer === rawOutputMaxBytes + 1_048_576`), killed → `SEARCH_ABORTED`, pre-aborted → the same and not the spawn-failure branch, never-started → **rejects** with ENOENT (the two domains of `:812-814`), grep exit 1 → `{matches: []}` while glob exit 1 stays `SEARCH_FAILED`, exit 3/127 detail = first line of a real 896-byte stderr cut at 300, overflow at 101/100 bytes. Controls run: delete `killSignal: "SIGKILL",` → 2 RED; drop the `code === 1 && toolName === "grep"` half → grep's 2 RED with glob's still green. Positive control asserts `fakeArmed()` false→true and every recorded call matched, so nothing real was ever spawned | pinned tree, fake-child fixture, built lib | ci.yml#runtime-tests |
| `npm run test:node` no longer rebuilds | the bucket consumed `npm run build &&`, so "the tests passed" also meant "the committed artifact was rewritten under foot" and the assertions ran against fresh bytes rather than shipped ones. `lint-build` already proved committed `lib/` = build(HEAD) byte-for-byte and gates this job, so consuming the committed bytes is the stronger claim. `test:node:fresh` keeps the rebuild-and-test spelling for local use | — | ci.yml#runtime-tests |

## C. Build / artifact-plane gates

| Check | What it pins down | CI home |
| --- | --- | --- |
| `npm run build` (clean → tsdown → verify) | the committed `lib/` is the current build pipeline's output | ci.yml#lint-build (plus every bucket that consumes lib) |
| `npm run verify` = `scripts/verify-lib.mjs` | every lib file imports the `node:*` specifiers it calls (statSync 0.2.3 class bug) and nothing bound gets tree-shaken away. **Floor added:** the declared entry names are derived from `tsdown.config.ts` via `tests/support/lib-entries.mjs` and each must exist on disk, so an empty or gutted `lib/` can no longer print `OK: 0 lib entries` and exit 0. Sentinel: move `lib/fs.js` away → `RED … missing declared entry output: fs.js`, restore → GREEN | ci.yml#lint-build |
| `npm run verify:lib-sync` = `scripts/verify-lib-sync.mjs` | the working tree's `lib/` equals HEAD: no modified, no untracked, no deleted file (22 names compared by basename). `git diff --quiet -- lib` cannot see an untracked addition and this tree is checked out clean in CI, so the real hole it closes is the **publish path** — `prepublishOnly` used to run only `verify:install`, which is how `c3be1fd`'s "lib was hand-patched earlier" class reached an npm tarball. Now wired into `prepublishOnly` and as the first `lint-build` step (`--check-only`), before any build can rewrite `lib/`. Sentinel: `echo "// x" >> lib/fs.js` → RED; `touch lib/zz.js` → RED while `git diff --quiet -- lib` exits **0** (measured, the blind spot stated as evidence); `git rm`-equivalent (move a tracked file off disk) → RED naming it; restore → GREEN | ci.yml#lint-build |
| rebuild-vs-committed | `npm run build && git diff --quiet -- lib` — the committed artifact matches a build of the committed sources, byte for byte (`.gitattributes` keeps `lib/** -text` so this is exact) | ci.yml#lint-build |
| `node scripts/verify-artifact-identity.mjs` | the TESTING.md §13 contract, machine-run: pack with prepack rebuild, pack `--ignore-scripts` over committed lib, and a repeat pack must agree; byte-identical tarballs reported as the strongest form | ci.yml#lint-build |
| `npm run verify:install` | a clean plain-npm install of the packed tarball (the gate 0.7.0's E404 peer would have failed) | ci.yml#runtime-tests |
| `node scripts/typecheck-gate.mjs` | `tsc --noEmit` error count must not exceed `ci/typecheck-baseline.json` (the documented "count does not grow" convention, previously unenforced; `--record` rebaselines). **Premise now checked before counting:** `spawnSync` reports an unrunnable program without throwing, and this tsc exits **2** on a real run that reports all 212 baseline errors (measured — so exit status is not a usable "did it run" signal here). The gate refuses a `spawnSync` error, a null status, a missing `node_modules/typescript/{bin/tsc,lib/tsc.js}`, and a capture that yielded no countable line while printing a usage banner. Sentinel: rename `node_modules/typescript/bin/tsc` → `RED — the TypeScript compiler is not installed`, rc 1; restore → `OK — 212 errors equals baseline`, rc 0 | ci.yml#runtime-tests |

## D. Checks needing Windows + a real WSL distribution — `npm run test:wsl`

Hard gates in ci.yml#wsl-gate on windows-latest with WSL1 Ubuntu via
Vampire/setup-wsl. Environment knobs: `WSL_COMPAT_DISTRO`, `WSL_COMPAT_USER`,
`WSL_COMPAT_ROOT`, `WSL_COMPAT_RELAY_CWD`, `WSL_COMPAT_DRIVE_CWD`, and
`DSH_WSL_TEST_PLANE` (`src` default | `lib`).

**Which plane a gate tested is now evidence, not assumption (issue #44 §1).** Every driver
resolves its subject through `scripts/compatibility/plane.mjs`, which prints
`plane-module: <key> -> <specifier>`; `scripts/verify-plane-log.mjs <log> <src|lib>` fails a run
whose log carries no such line, names the wrong plane, or points at a content-hashed chunk.
`ci.yml#wsl-gate` runs `fs-real`/`search-real`/`relay-real` a second time under
`DSH_WSL_TEST_PLANE=lib` with a separate fixture root (`/tmp/dsh-wsl-lib`) and then checks every
log. Two decisions recorded rather than quietly taken: the **default stays `src`** until the lib
plane has been green twice on a runner; and `skills-real` is **still src-plane only**, because
`tsdown.config.ts` declares no entry for the provider (the class is file-local to
`lib/index.js:1122`) and adding entries changes what users install — `plane.mjs` therefore
*throws* under `lib` instead of falling back, so the gap cannot read as a pass. Measured on the
maintainer machine (WSL2, smoke tier only — not evidence about WSL1): `fs-real` under
`DSH_WSL_TEST_PLANE=lib` printed `plane-module: fs -> lib/fs.js`, reported both `PASS real 9P fs…`
lines, rc 0, and the verifier answered `OK — 1 plane line(s) … all lib`.

Verifier controls run here: a log with no plane line → rc 1; a `src` log checked as `lib` → rc 1;
`lib/wsl-Ckyi3g6C.js` → rc 1 (`content-hashed chunk`); a matching line → rc 0.

| Check | What it pins down | Notes |
| --- | --- | --- |
| `tests/smoke.ts` | distro discovery, full 9P UNC file round-trip, WSL-side bash (cwd translation, WSLENV, stdin, background), `/mnt/<drive>` dual access, default-distro fallback | asserts tmpdir's UNC and `/mnt` spellings match exactly — a remapped `%TEMP%` whose drive letter case differs from the 9P spelling trips the dual-access assertion (seen on a machine with `TEMP=D:\Temp`) |
| `tests/exec-shape.mjs` | the Desktop `child_process`-wrapper regression (#35/#36) in probe subprocesses, wrapped and plain shapes, through the real `listDistros`/`defaultDistro`/`resolveLinuxSymlink` | reads HKCU Lxss (needs a registered default distro); slow, bounded at 60 s |
| `tests/shell-extra.mjs` | cwd with spaces + a single quote, explicit `DSH_WSL_USER`, foreground timeout (`timedOut`), AbortController cancellation | |
| `tests/smoke-built.ts` via `scripts/make-smoke-built.mjs` | the whole smoke pass run against `lib/` instead of `src/` — previously only existed as a runtime rewrite inside Run-Checks.ps1 | generated, gitignored |
| `scripts/compatibility/fs-real.mjs` | symlink × policy-fence combinations on the real share (outside link denied, dangling link creates, distro `/tmp` allowed) | fixtures under `$HOME`, not `/tmp`, to keep the temp allowance honest |
| `scripts/compatibility/skills-real.mjs` | real-9P skill discovery: CRLF+BOM bodies, external linked project, nested-below-linked, dangling, loop, node_modules trap | exercises how the share enumerates Linux symlinks — the WSL-build-sensitive check |
| `scripts/compatibility/search-real.mjs` | GNU grep/find contract inside the distro over real fixtures (framing, caps, footers, cards) | its Windows-/mnt assertion names the maintainer machine's deployed copy by default — CI points `WSL_COMPAT_DRIVE_PATH` at this checkout's own `tests` dir (runner frame 3: find died on the absent D:\ProgramData tree). The searches run through `wsl.exe … -e bash -c <script>`; older WSL builds (this machine's 2.1.5) reject that form with ERROR_FILE_NOT_FOUND (stderr UTF-16 → decodes empty), newer builds are fine |
| `scripts/compatibility/relay-real.mjs` | the persistent-shell relay: state (`export`, `cd`) survives between sends, starts in the session cwd, honours `DSH_WSL_DISTRO`/`DSH_WSL_USER` | spawns with the session UNC as cwd — two prerequisites: the UNC directory must exist **inside a running instance** (the share is invisible when the distro idles out, and the resulting `spawn … ENOENT` misleadingly names node.exe), and CI keeps a bounded `sleep` alive during the run. GREEN on the WSL1 runner (frame 4) and green on this Win10 machine once the env string carried real double backslashes — an earlier "Win10 cannot spawn with a UNC cwd" attribution here was **wrong** (the shell had eaten one escaping layer; 20/20 UNC-cwd spawns succeed with a correct path); retracted 2026-09-30 |

`scripts/compatibility/host-api.mjs` (12 API probes) needs a running
`dsh web` and lives in the compat matrix, not in ci.yml: the compat job boots
one per version. v0.7.5 adds `scripts/compatibility/conpty-relay.mjs` (the
relay interpreter under a real ConPTY, per the case's `runtime.json`) at the
same tier: it is registered in Run-Checks.ps1 for the maintainer sweep and
needs a booted case manifest, so no cloud fixture exists for it yet —
recorded here rather than silently dropped from the automation map.


## E. Compatibility matrix

| Driver | What it does | Where |
| --- | --- | --- |
| `scripts/verify-dsh-compat.sh <version…>` | per dsh release: isolated `DSH_HOME`, `npm i @deepseek-ai/dsh@<v>`, `dsh plugin --profile web add` (set `PLUGIN_REF` to the **extracted plugin directory** — `plugin add` accepts a package name or a local directory, never a .tgz path), boot web, probe `POST /wsl-workspace/api listDistros` = 200, uninstall, re-probe must be gone; exits non-zero unless every verdict line is `PASS compatible` (a frame-1 discovery: the script used to print failures under a green checkmark) | compat.yml matrix over `ci/compat-window.json` (rolling 3 releases; weekly + dispatch + window-file changes) |
| `scripts/compatibility/*.ps1` (Prepare/Start/Run-Checks/Stop/Check-Uninstall) | the full 15-check sweep per case, pnpm-pinned case trees, junctions, PS 7.2 | manual / maintainer machine; kept as the deep tool |
| `scripts/repro-setup.sh` + `scripts/repro-e2e.mjs` | builds the nested-skill repro tree inside a distro and drives the provider against the real share — **10 asserted checks** with a non-zero exit, since the night run that rewrote it. It previously printed four listings and exited 0 whatever they contained while this table called them "4 printed assertions"; `grep -cE 'assert|throw|exit'` on the old file returned 0, and the empty-catalogue run that follows proves the difference. Also pins the negative half the fixture builds (`node_modules`, a dot-directory, a tree past `MAX_SCAN_DEPTH`) and that a nested project must **not** serve a sibling's skills | local, env-overridable; under Git Bash use `MSYS_NO_PATHCONV=1` for `WSL_REPRO_ROOT` and `bash -c` for the setup run |

## F. Still human (TESTING.md "End-to-end verification in the running harness")

- W button visible beside Settings in the sidebar foot.
- Distribution picker non-empty by eye (the #35/#36 failure shape was an
  empty picker with a caught type error; client-lifecycle now covers the
  server half, the pixel is human).
- Mode picker shows and lands on `WSL · <mode>` variants; Standard/PTC/
  Minimal/Creative switches.
- F5/panel reload keeps the workspace (TESTING.md itself states no script
  can see the client half).
- The six-item frontend pass per release (create & open, write, read,
  one-shot bash, persistent bash, skills) — the commandable half of each is
  automated in ci.yml#wsl-gate and compat.yml; the click half stays human.
- Agent-session nested-skill probe (needs a real model session).

## Local baseline, 2026-09-30 (Windows 10 19045 / WSL 2.1.5 / user machine, pinned tree installed)

| Group | Result |
| --- | --- |
| A recount, 2026-09-30 night run (`ci/gate-floors`, this frame) | **Measured counts differ from the row below.** The original four files report `tests 55 / pass 55 / fail 0`, not 84/84; with the three checks added tonight (`wsl-output-decode` 10, `client-classnames` 6, `fake-child-process` 5) `npm run test:unit` reports **76 / 76 / 0**, rc 0. Bucket B also gains `tests/persistent-shell-fallback.mjs` (24 labelled asserts, `PASSED`, rc 0). The "84/84" figure could not be reproduced in this frame and is left below as history rather than corrected in place. |
| Live tier, same night run | `scripts/repro-e2e.mjs` turned from prints into 10 assertions and was run for the first time against a real tree: **RED (4 failing) with the fixture missing or with `WSL_REPRO_ROOT` mangled by MSYS** — the exact conditions under which the old file printed `(none)` and exited 0 — then **`REPRO E2E PASSED (10 assertions)` rc 0** on `\\wsl.localhost\Ubuntu\home\ruler\repro-ws-root` (WSL2, smoke tier). `host-api.mjs` gained a 12-probe floor: an empty run now prints `host-api: RED — ran 0 probes, expected 12` and exits 1 instead of `0/0 checks passed` with rc 0. |
| A (4 files, `npm run test:unit`) | GREEN 84/84 |
| B (`npm run test:node`: 68 --test assertions + HOST MATERIALIZE PASSED + HOST DECLARE PASSED + rank match) | GREEN; strict negative (no host tree → rc 1) and drift mutation (rank 999 → rc 1) both verified |
| C | rebuild byte-stable after the `chore(lib)` absorption commit; artifact identity: three packs byte-identical; mutation control (appended byte to a lib file) → RED, restore → GREEN; typecheck baseline recorded at 212 |
| D (local Win10 19045 / WSL2 2.1.5) | exec-shape / shell-extra / fs-real GREEN; generator + smoke + smoke-built GREEN with a normalized `TMP=C:/tmp` (case-strict dual-access spelling vs native `%TEMP%=D:\Temp`); relay-real GREEN once the env path carried real double backslashes — the earlier "Win10 cannot spawn with a UNC cwd" attribution was **wrong** (the shell had eaten one escaping layer; 20/20 UNC-cwd spawns succeed), retracted 2026-09-30; skills-real RED — this machine's 9P presents the external link as `other` and `lstat` throws EISDIR, the provider skips it (GREEN on the WSL1 runner); search-real RED — `wsl.exe … -e bash` fails with ERROR_FILE_NOT_FOUND on this WSL build, stderr in UTF-16 decodes empty (GREEN on the runner) |
| D (CI, WSL1 Ubuntu-24.04, windows-latest) | frame 4 (c6f0a4b): 8/9 gates GREEN, only search-real died on its Windows-fixture default (the maintainer machine's `D:\ProgramData\…` path), fixed via `WSL_COMPAT_DRIVE_PATH`; frame 5 (ac5219e): **all three checks jobs GREEN** |
| E compat (CI, final frame) | after the pkg-tree staging fix (a pnpm `link:`'s realpath is the source directory; peers must sit on its walk-up, so the unpacked plugin is copied into `$WORK/pkg/node_modules` before `plugin add`): **all three matrix versions `PASS compatible`** (verdicts.txt verbatim for 0.2.0-rc.2 / 0.2.0-rc.1 / 0.1.7-rc.2) with the honest verdict gate — the fix was first validated minimally on the Win10/WSL2.1.5 machine (stage→add→boot→listDistros 200 in 4 s) before the full matrix ran |
| Product silent paths closed alongside (`src/` + rebuilt `lib/`), same night | `check` no longer folds an unreadable path into `exists:false` — only `ENOENT`/`ENOTDIR` answer "absent", any other throw (`EPERM`, a dead 9P share) answers `{ok:false}` naming the cause (`src/index.ts:320-333`); `api.ts` bounds every call at 30 s via `AbortSignal.timeout` (guarded: the lifecycle test's `vm` sandbox has no `AbortSignal`, and the unguarded first version failed 4 tests), checks `response.ok`, and never throws an empty message; the error strip's Retry re-runs the open flow through the same `loadOnOpen` instead of only hiding the error; `.dww-action--wide` got a rule mirroring `--rail`. The class-name gate then **refused to stay green**: it reported its own stale registration (`dww-action--wide now have rules — delete the registration`), and deleting that line restored 76/76. Wide-sidebar "labeled row" remains an open design question named in the stylesheet, not styled tonight. |
| merge frame (origin/main #39 in) | merged #39 (PTY-relay node-executable fix, src/index.ts + lib/index.js only); lib rebuilt on the merged src, byte-stable; cloud: checks **success** + dispatched compat matrix **success**, all three versions `PASS compatible` again (matrix closed 2026-09-30T10:56:31Z per the run's server updatedAt) |
| E compat (local rehearsal, dsh 0.2.0-rc.2) | full chain GREEN after four harness fixes: (1) verdict-based exit — the script used to exit 0 under all-FAIL verdicts (its own false green, frame-1 CI read three `PLUGIN_ADD_FAIL` lines under a green checkmark); (2) `PLUGIN_REF` is the **extracted directory**, `plugin add` rejects a .tgz path; (3) readiness now means "any HTTP response" — 0.2.0-rc gates `/` behind a browser token (401 anonymous, 303→`./` drops the query), so an HTML-content probe can never settle; plugin health is asserted by the API poll instead; (4) `curl -w %{http_code}` + `|| echo 000` double-printed "000000" and defeated the dead-server comparison — removed at both sites; API probe polls to 200 because route registration races boot. Final: `0.2.0-rc.2 PASS compatible`, uninstall clean (405). CI-side root cause on top: the windows runner's bash PATH lacks **pnpm**, which the dsh plugin manager shells out to — compat.yml installs it |
## Measured and rejected during the night run (do not re-propose from the review's estimates)

The review ranked some cost reductions from subagent estimates. Two do not survive measurement,
and the reason is recorded so nobody spends a wave on them again:

- **Merging the preset fixtures is worth nothing here.** `tests/host-materialize.mjs` and
  `tests/host-declare.mjs` both declare `STANDARD_SRC`/`MINIMAL_SRC` and 17 of 22 body lines
  match, but compared as text the blocks give **0 byte-identical lines** — the `const … = \`…\``
  shapes, indentation and the fields each harness asserts differ — so a shared module would carry
  both variants anyway. `tests/variants.test.ts`'s fixture is deliberately richer (26 lines,
  3-4 positional matches against the host pair), and collapsing it into the harness fixtures would
  delete coverage rather than move it.
- **The hermeticity list was largely already handled.** `smoke.ts:46` already `rmSync`s its target
  before asserting, the two smoke suites run sequentially in one `run_one` loop, and
  `shell-extra.mjs` asserts `pwd` equals a directory it creates, so a stale tree cannot answer
  "pass". The real new risk was two *concurrent* passes over one `/tmp/dsh-wsl-compat`, introduced
  by tonight's lib-plane run — handled by giving the second pass its own root, not by rewriting
  the drivers.
- Taken from that list: `npm run test:node` no longer rebuilds `lib/` (bucket B), and
  `tests/persistent-shell-fallback.mjs` registers an `exit` handler for its `DSH_HOME` tree,
  because on this machine `os.tmpdir()` is `D:\Temp` and a mid-scenario throw would leak
  directories that `git status` cannot see. Verified after the change: 0 orphans under any of the
  seven prefixes this run created (the 1086 `dsh-*` directories already in `D:\Temp` carry
  prefixes from other work — `guard`, `acl`, `subprocess`, … — and are not this suite's litter).

| Attribution | the four D reds are machine-shape findings (recorded above per check); CI on fresh runners is the arbiter for the hard gates; none of the four is silently downgraded |
