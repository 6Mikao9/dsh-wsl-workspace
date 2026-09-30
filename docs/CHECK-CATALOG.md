# Check catalog

Single inventory of every test, gate and manual pass in this repository, its
run command, its environment prerequisites, and where it lives in the
automation. CI wiring: `.github/workflows/ci.yml` (per PR/push) and
`.github/workflows/compat.yml` (rolling window, weekly/dispatch). Local and CI
run the same commands: the `npm run test:*` buckets below.

## A. Pure-node unit bucket — `npm run test:unit` (+ `npm run test:skills`), no host packages needed

| Check | What it pins down | Prereq | CI home |
| --- | --- | --- | --- |
| `tests/variants.test.ts` | WSL preset-variant transform: row stripping, realm injection, exactly-once re-injection, unknown rows survive | node ≥ 24 | ci.yml#lint-build |
| `tests/paths.test.ts` | UNC↔Linux path conversion, `/mnt/<drive>` mapping, Windows-path keys, distro-username validation | node ≥ 24 | ci.yml#lint-build |
| `tests/locales.test.ts` | zh/en dictionary key parity, no empty values, help-panel body shape | node ≥ 24 | ci.yml#lint-build |
| `tests/wsl-skills.test.ts` | skill provider over an in-memory IO fake: nested discovery, ranks, frontmatter incl. block scalars, depth/budget, cache TTL, dir-symlink following | node ≥ 24 — **runs on the windows runner** (`npm run test:skills`, ci.yml#wsl-gate): two expected UNC strings assume win32 `path.join`; on ubuntu the same provider code yields `/`-joined paths (first CI frame 2026-09-30, 2/84 failed there, all other bucket-A files platform-neutral) | ci.yml#wsl-gate |

## B. Node buckets needing the pinned host packages — `npm run test:node`

The `@deepseek-ai/*` peers are optional and provided by the host at runtime;
in a clean checkout `node ci/install-pinned.mjs` materialises the pinned tree
(ci/pinned-deps.json → ci/deps) and links it in. `test:node` rebuilds `lib/`
first because the client/host integration checks consume built artifacts.

| Check | What it pins down | Extra prereq | CI home |
| --- | --- | --- | --- |
| `tests/shell.test.ts` | login-shell `cd` prefix keeps the workdir (quote escaping); non-login shells leave the command alone | cordis | ci.yml#runtime-tests |
| `tests/fs-execution-context.test.ts` | `WslFileSystem` inherits the session cwd through AsyncLocalStorage; falls back to the configured distro without an agent | cordis | ci.yml#runtime-tests |
| `tests/fs-policy.test.ts` | write fence across `workspace-write` / read-only / danger-full-access / no-policy, plus the symlink-resolution seam (creates `.fs-policy-*` dirs in cwd, cleans up in finally) | cordis | ci.yml#runtime-tests |
| `tests/wsl-jobs.test.ts` | background-job producer (regression: `run_in_background` was silently ignored) | schemastery, dsh-tools | ci.yml#runtime-tests |
| `tests/wsl-search.test.ts` | grep/glob twins vs the host `dsh-tool-fs-search` exported pieces (framing, caps, footers) — drift detector | dsh-tool-fs-search, dsh-output-retention | ci.yml#runtime-tests |
| `tests/client-lifecycle.test.mjs` | the published `lib/client.js` in a vm sandbox against legacy + current runtime facades: preset binding, create & open, late-service registration | built lib | ci.yml#runtime-tests |
| `tests/host-materialize.mjs` | host `apply()` directory channel: generated rows reference real lib files, atomic publish, stale cleanup, legacy `wsl` removal | cordis, schemastery, js-yaml, built lib | ci.yml#runtime-tests |
| `tests/host-declare.mjs` | declaration channel (0.1.7+): capability switch, one declaration per healthy source, `!!js` round-trip, dispose retires all — must run paired with the check above | same | ci.yml#runtime-tests |
| `scripts/check-rank-parity.mjs --strict` | PROJECT_\*\_RANK copies vs the host dsh-skill-filesystem lib; `--strict` makes a missing host package a failure (the flag was documented but not honoured until 0.7.4+CI) | pinned tree | ci.yml#runtime-tests |

## C. Build / artifact-plane gates

| Check | What it pins down | CI home |
| --- | --- | --- |
| `npm run build` (clean → tsdown → verify) | the committed `lib/` is the current build pipeline's output | ci.yml#lint-build (plus every bucket that consumes lib) |
| `npm run verify` = `scripts/verify-lib.mjs` | every lib file imports the `node:*` specifiers it calls (statSync 0.2.3 class bug) and nothing bound gets tree-shaken away | ci.yml#lint-build |
| rebuild-vs-committed | `npm run build && git diff --quiet -- lib` — the committed artifact matches a build of the committed sources, byte for byte (`.gitattributes` keeps `lib/** -text` so this is exact) | ci.yml#lint-build |
| `node scripts/verify-artifact-identity.mjs` | the TESTING.md §13 contract, machine-run: pack with prepack rebuild, pack `--ignore-scripts` over committed lib, and a repeat pack must agree; byte-identical tarballs reported as the strongest form | ci.yml#lint-build |
| `npm run verify:install` | a clean plain-npm install of the packed tarball (the gate 0.7.0's E404 peer would have failed) | ci.yml#runtime-tests |
| `node scripts/typecheck-gate.mjs` | `tsc --noEmit` error count must not exceed `ci/typecheck-baseline.json` (the documented "count does not grow" convention, previously unenforced; `--record` rebaselines) | ci.yml#runtime-tests |

## D. Checks needing Windows + a real WSL distribution — `npm run test:wsl`

Hard gates in ci.yml#wsl-gate on windows-latest with WSL1 Ubuntu via
Vampire/setup-wsl. Environment knobs: `WSL_COMPAT_DISTRO`, `WSL_COMPAT_USER`,
`WSL_COMPAT_ROOT`, `WSL_COMPAT_RELAY_CWD`, `WSL_COMPAT_DRIVE_CWD`.

| Check | What it pins down | Notes |
| --- | --- | --- |
| `tests/smoke.ts` | distro discovery, full 9P UNC file round-trip, WSL-side bash (cwd translation, WSLENV, stdin, background), `/mnt/<drive>` dual access, default-distro fallback | asserts tmpdir's UNC and `/mnt` spellings match exactly — a remapped `%TEMP%` whose drive letter case differs from the 9P spelling trips the dual-access assertion (seen on a machine with `TEMP=D:\Temp`) |
| `tests/exec-shape.mjs` | the Desktop `child_process`-wrapper regression (#35/#36) in probe subprocesses, wrapped and plain shapes, through the real `listDistros`/`defaultDistro`/`resolveLinuxSymlink` | reads HKCU Lxss (needs a registered default distro); slow, bounded at 60 s |
| `tests/shell-extra.mjs` | cwd with spaces + a single quote, explicit `DSH_WSL_USER`, foreground timeout (`timedOut`), AbortController cancellation | |
| `tests/smoke-built.ts` via `scripts/make-smoke-built.mjs` | the whole smoke pass run against `lib/` instead of `src/` — previously only existed as a runtime rewrite inside Run-Checks.ps1 | generated, gitignored |
| `scripts/compatibility/fs-real.mjs` | symlink × policy-fence combinations on the real share (outside link denied, dangling link creates, distro `/tmp` allowed) | fixtures under `$HOME`, not `/tmp`, to keep the temp allowance honest |
| `scripts/compatibility/skills-real.mjs` | real-9P skill discovery: CRLF+BOM bodies, external linked project, nested-below-linked, dangling, loop, node_modules trap | exercises how the share enumerates Linux symlinks — the WSL-build-sensitive check |
| `scripts/compatibility/search-real.mjs` | GNU grep/find contract inside the distro over real fixtures (framing, caps, footers, cards) | |
| `scripts/compatibility/relay-real.mjs` | the persistent-shell relay: state (`export`, `cd`) survives between sends, starts in the session cwd, honours `DSH_WSL_DISTRO`/`DSH_WSL_USER` | spawns with the session UNC as cwd — Windows builds that reject a UNC child cwd (Win10 19045) fail with a misleading `spawn … ENOENT`; the share also disappears when the instance idles out, so CI keeps a bounded `sleep` alive during the run |

`scripts/compatibility/host-api.mjs` (12 API probes) needs a running
`dsh web` and lives in the compat matrix, not in ci.yml: the compat job boots
one per version.

## E. Compatibility matrix

| Driver | What it does | Where |
| --- | --- | --- |
| `scripts/verify-dsh-compat.sh <version…>` | per dsh release: isolated `DSH_HOME`, `npm i @deepseek-ai/dsh@<v>`, `dsh plugin --profile web add` (set `PLUGIN_REF` to a local tarball for unpublished commits), boot web, probe `POST /wsl-workspace/api listDistros` = 200, uninstall, re-probe must be gone | compat.yml matrix over `ci/compat-window.json` (rolling 3 releases; weekly + dispatch + window-file changes) |
| `scripts/compatibility/*.ps1` (Prepare/Start/Run-Checks/Stop/Check-Uninstall) | the full 15-check sweep per case, pnpm-pinned case trees, junctions, PS 7.2 | manual / maintainer machine; kept as the deep tool |
| `scripts/repro-setup.sh` + `scripts/repro-e2e.mjs` | builds the nested-skill repro tree inside a distro and drives the provider against the real share (4 printed assertions) | local, env-overridable |

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
| A (4 files, `npm run test:unit`) | GREEN 84/84 |
| B (`npm run test:node`: 68 --test assertions + HOST MATERIALIZE PASSED + HOST DECLARE PASSED + rank match) | GREEN; strict negative (no host tree → rc 1) and drift mutation (rank 999 → rc 1) both verified |
| C | rebuild byte-stable after the `chore(lib)` absorption commit; artifact identity: three packs byte-identical; mutation control (appended byte to a lib file) → RED, restore → GREEN; typecheck baseline recorded at 212 |
| D | exec-shape / shell-extra / fs-real GREEN; generator + smoke + smoke-built GREEN with a normalized `TMP=C:/tmp`, RED with this machine's native `%TEMP%=D:\Temp` (the dual-access spelling check is case-strict against the 9P form); relay-real RED — Win10 19045 cannot spawn with a UNC child cwd (system limit, harness-independent); skills-real RED — this machine's 9P enumeration presents the external link as `other`/`lstat EISDIR`, the provider skipped it; search-real RED — distro grep exited -1, cause undetermined locally |
| Attribution | the four D reds are machine-shape findings (recorded above per check); CI on fresh runners is the arbiter for the hard gates; none of the four is silently downgraded |
