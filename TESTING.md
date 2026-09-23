# Testing

This document describes how to verify `dsh-wsl-workspace` after a change or before a release. The suite covers unit tests, the two preset-channel integration tests (the retired directory generation and the declaration generation), a real-WSL smoke test, and a post-build lib verification gate.

## Prerequisites

- Windows host with WSL2 and at least one distribution installed (`wsl.exe` on `PATH`).
- Node.js 24+ (the tests run with Node's built-in TypeScript support; `tsx` is not required).
- The DeepSeek Harness checkout (for `tsc`/`tsdown` and the `@deepseek-ai/*` type declarations the `tsconfig.json` paths point at).

## Unit tests

Run the unit tests from the plugin directory:

```powershell
node --experimental-strip-types --test tests/variants.test.ts tests/fs-execution-context.test.ts tests/shell.test.ts tests/paths.test.ts tests/wsl-skills.test.ts
```

Coverage:

| File | What it verifies |
|---|---|
| `tests/variants.test.ts` | The WSL preset-variant transform: world rows are dropped, the WSL realm is injected, `str-replace-editor` is re-injected exactly once (and only when the source references it), prefab-family rows (`custom-bash`, `bootstrap-filesystem`) are removed, unknown rows are preserved verbatim. |
| `tests/fs-execution-context.test.ts` | `WslFileSystem` inherits the calling session's cwd through `AsyncLocalStorage` on `tools/execute`; agentless calls fall back to the configured distro. |
| `tests/shell.test.ts` | The login-shell `cd` prefix preserves the resolved workdir (including single-quote escaping); non-login shells leave the command unchanged. |
| `tests/paths.test.ts` | UNC ↔ Linux path translation, `/mnt/<drive>` mapping, canonical Windows path keys, WSL username validation. |
| `tests/wsl-skills.test.ts` | The WSL skill provider (issue #10): non-WSL lookups return nothing, nested `.dsh/skills` / `.agents/skills` discovery with host ranks/sources, `get()` body loading, pruning of `node_modules` / dot-directories, frontmatter validation **including block scalars**, depth and skill-root budgets, the nearest-`.git`-ancestor rule (a cwd deeper than the project root still sees the project's skills, and skills above that ancestor do not leak), the skill-root cap, the **10-second per-scan-root lookup cache** (copy semantics, TTL expiry, `get()` staying live), **directory-symlink following** (linked projects discovered, aliasing deduplicated, dangling symlinks pruned, hops bounded by depth). |

## Provider parity and compatibility checks

- `node scripts/check-rank-parity.mjs` — the provider's project ranks are copied from `@deepseek-ai/dsh-skill-filesystem` (the host does not export them). This script parses the host's built lib when the package is resolvable on this machine and fails on drift. Run it before every release on a machine with the harness installed.
- `scripts/verify-dsh-compat.sh <version>...` — disposable-Profile install/start/uninstall evidence against specific `@deepseek-ai/dsh` releases: fully isolated (`DSH_HOME` redirected to a temp tree, own port), boots the published harness version with the plugin added by name, probes `POST /wsl-workspace/api`, then removes the plugin and verifies the route disappears. Emits per-version verdict lines used for the `dsh.compatibility.dshReleases` manifest records.

## Preset materialization integration test

Boots the host plugin's `apply()` against a fake context with `DSH_HOME` pointed at a temp directory, then asserts the generated variant rows reference real built lib files and the composition carries the WSL execution-world realm:

```powershell
node tests/host-materialize.mjs
```

This covers variant generation, opaque source-directory mirroring (third-party assets travel with the variant), atomic publication (a failed regeneration preserves the previous complete variant), stale-variant cleanup, and legacy `wsl` preset removal. Its fake roster face is the **directory generation** (`list()` reporting a `path`, `read()` returning text), i.e. the channel every release up to `0.1.5-rc.2` uses.

## Preset declaration integration test

Boots the same `apply()` against the **declaration generation** of the roster face — `list()` reporting metadata without a directory, `readDocument()` returning a composition document, `register()` publishing a declaration — which is the channel `0.1.7-alpha.1` and later use, because that line stopped scanning `$DSH_HOME/.agent-presets/`:

```powershell
node tests/host-declare.mjs
```

This covers the capability switch, one declaration per healthy source (broken sources and existing `wsl-*` presets skipped), display name/description/order taken from the roster face rather than a `preset.yml`, the declaration's row list being an importable entry list (the world group, its isolating realm, the `!!js` disabled expression that must round-trip as an expression node, config values such as the relay and interpreter paths that must *not* become `file:` URLs), the world's own providers named as `file:` URLs pointing at real built files, that the retired root is neither written nor left holding stale leftovers, and that disposing the plugin retires every declaration it published.

Run both before a release: the two files are the two halves of the same generator, and a change to either channel must not silently break the other.

## Real-WSL smoke test

Requires a running WSL distribution (the first listed distro is used; infrastructure distros such as `docker-desktop` are skipped):

```powershell
node --experimental-strip-types tests/smoke.ts
```

This exercises the filesystem round-trip (resolve/write/read/edit/stat/version/listDir/contains/fileUrl), bash execution inside WSL (cwd translation, WSLENV pass-through, stdin, background jobs), Linux-workdir resolution through the session distro fact, `/mnt/<drive>` dual access, and the no-config default-distro fallback.

## Post-build lib verification

`scripts/verify-lib.mjs` parses every `lib/*.js` entry and fails the build when a bare call to a Node builtin export has no matching `node:*` import. This catches the class of bug where a symbol is used but never imported (for example `statSync` in 0.2.3, which made the Add-WSL-Workspace dialog report every path as non-existent at runtime):

```powershell
node scripts/verify-lib.mjs
```

The `build` script clears the committed `lib/` first and chains the gate after `tsdown`:

```powershell
pnpm build   # node scripts/clean-lib.mjs && tsdown && node scripts/verify-lib.mjs
```

The clean step is not optional: `tsdown` runs with `clean: false` and the node and
client configurations share `lib/` as their output directory, so without it every
code-split chunk an earlier build emitted stays in the tree (and, once a file is
renamed, ships in the tarball as dead weight).

## Nested skill-catalog regression (issue #10)

The WSL skill provider publishes `.dsh/skills` / `.agents/skills` from nested projects below a WSL workspace (and from the cwd's nearest `.git` ancestor). Regression-test it on the real 9P share:

1. Rebuild the repro tree inside the distribution (`scripts/repro-setup.sh` creates `~/repro-ws-root` with nested projects, pruned traps, and an over-budget deep skill):

   ```powershell
   cp scripts/repro-setup.sh //wsl.localhost/<distro>/tmp/
   wsl -d <distro> -- bash -c "bash /tmp/repro-setup.sh"
   ```

2. Drive the provider against the real `\\wsl.localhost` share — four assertions print (workspace-root cwd finds root + nested skills; nested-project cwd finds only that project; `get()` loads a body; non-WSL cwd returns nothing). Override the target with `WSL_COMPAT_DISTRO` / `WSL_COMPAT_USER` / `WSL_COMPAT_ROOT`:

   ```powershell
   node scripts/repro-e2e.mjs
   ```

   The script hardcodes `\\wsl.localhost\<distro>\home\<user>\repro-ws-root`; adjust the two paths at the top when running as another user or distro.
3. In the running harness, open a session on the repro workspace and ask the agent to load the nested skills (`brainstorming`, `systematic-debugging`, `writing-plans`) through its skill tool — each must load with the `wsl-workspace` provider attribution, and no duplicate entries may appear. In a non-WSL workspace session the same skills must be "unknown".
4. Clean-install check (simulates another user): `npm pack`, `npm install <tarball>` in an empty temp project (peers must resolve), then `dsh plugin --profile web add <extracted tarball dir>`, restart `dsh web`, and repeat the end-to-end checks below plus the nested-skill probe above.

## End-to-end verification in the running harness

After installing the plugin into a profile and restarting `dsh web`:

1. The **W** button appears beside Settings at the sidebar foot.
2. Open "Add WSL workspace…", browse to a directory (e.g. `/home`), and click "Create & open" — the workspace must be created without a "path does not exist" error.
3. In the new session, the mode picker shows the WSL variant (e.g. `WSL · Standard mode（标准模式）`); the bash tool runs inside the distribution (`pwd` returns a Linux path, `uname -s` returns `Linux`).
4. `read`/`write`/`edit` operate on WSL files; Windows files stay reachable under `/mnt/<drive>`.
5. Switch modes (Standard / PTC / Minimal / Creative) — each lands on its WSL variant and the tool catalog matches the mode.
6. The plugin API responds correctly: `POST /wsl-workspace/api` with `{"method":"check","params":{"distro":"<distro>","path":"/home"}}` returns `{"ok":true,"value":{"exists":true,"isDirectory":true}}`.

## Release checklist

1. `pnpm build` — clears `lib/`, rebuilds it, and runs the verification gate.
2. `node --experimental-strip-types --test tests/*.test.ts` — all green (locales, variants, paths, shell, fs execution context, fs policy, wsl skills, wsl search).
3. `node tests/host-materialize.mjs` — all assertions pass (the directory channel).
4. `node tests/host-declare.mjs` — all assertions pass (the declaration channel).
5. `node --experimental-strip-types tests/smoke.ts` — real-WSL round-trip passes.
6. `node scripts/check-rank-parity.mjs` — host rank constants still match our copies.
7. `node scripts/repro-e2e.mjs` (after `scripts/repro-setup.sh`) — nested skill-catalog assertions pass.
8. `npm pack --dry-run` — confirm the tarball carries only live `lib/` chunks, `src/`, `cordis.patch.yml`, READMEs, `LICENSE`, and `NOTICE`.
9. `npm run verify:install` — packs the tree and installs the tarball with **plain npm** into a scratch directory, with no pnpm and no host packages present. This is the gate that would have caught 0.7.0, whose `peerDependencies` made npm auto-install an unpublished package (`E404 @deepseek-ai/dsh-retention`): every other check and every real session goes through `dsh plugin add` (pnpm), which only *warns* about unmet peers and installs anyway. `prepublishOnly` runs it, so `npm publish` now refuses to ship a package that npm users cannot install.
10. Install the tarball into a clean profile (`dsh plugin --profile web add <tarball>`), restart `dsh web`, and run the end-to-end checks above plus the nested-skill probe. When the compatibility manifest changes, also run `scripts/verify-dsh-compat.sh` for every declared release.
11. For a release, install the *published* version by name into one isolated case per declared release and confirm each boots (the launcher only reports ready once the plugin's API route answers) — the check that proves the artifact on the registry, not just the local tree.

### The multi-release check harness

`scripts/compatibility/` prepares one isolated case per declared release (its own
`DSH_HOME`, its own dependency tree pinned to that release, the plugin installed
into it) and runs a fixed check list inside it. The drivers require PowerShell 7.2,
so on a Windows PowerShell 5.1 host use the Node equivalent:

```powershell
node .test-runs/harness.mjs <runId> 0.1.0-rc.7 0.1.5-rc.2   # prepare + check
node .test-runs/harness.mjs <runId> --checks 0.1.5-rc.2      # re-check an existing case
```

Four checks need a live WSL distribution (`skills-real`, `fs-real`, `relay-real`,
`search-real`); they build their own fixtures under `/tmp/dsh-wsl-compat` (override
with `WSL_COMPAT_ROOT`, and the distribution with `WSL_COMPAT_DISTRO`) and remove
them again. `host-api` needs a running `dsh web` for the case, so it is expected to
fail in a sweep. The `typecheck` baseline is two pre-existing errors from the
harness's own type declarations.