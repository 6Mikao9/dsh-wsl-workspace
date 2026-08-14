# dsh-wsl-workspace

[中文](README.md)

Add WSL workspaces from the DeepSeek Harness web GUI and switch the **entire
agent workspace** into a local WSL distribution, VS Code Remote-WSL style:
bash commands, file reads/writes (read/write/edit) all land in the WSL
execution world, with **zero installation inside WSL** (no DSH toolchain to
set up on the Linux side).

## How it works

- **Workspace identity = UNC path** (`\\wsl.localhost\<distro>\<linux path>`).
  Windows Node reads and writes the path directly (9P share), so `fs-wsl`
  works with zero installation; `processPath`/`displayPath` expose Linux
  paths to the model.
- **Per-session execution world = preset variant family**. On startup the
  plugin generates a `wsl-<mode>` variant for every healthy roster mode
  (Standard, PTC, Minimal, Creative, custom) — `wsl-standard`, `wsl-code`,
  `wsl-minimal`, `wsl-cordis`, … — under `<dshHome>/.agent-presets/` (the
  roster's auto-scanned user root). Each variant provides `shell`
  (`WslShellExecutor`: `wsl.exe -d <distro> --cd <linux cwd> -e bash -lc`
  with WSLENV pass-through) and `fs` (`WslFileSystem`) behind one
  entry-local realm, plus `tool-bash`/`tool-fs` consumers — the **execution
  world is orthogonal to the mode**: in a WSL workspace you can still pick
  Standard/PTC/Minimal/Creative and the toolchain runs inside WSL. There is
  **no standalone WSL mode**; a legacy standalone `wsl` preset directory is
  cleaned up on boot.
- **Auto-binding (mode mapping)**. The client watches the session list: any
  **blank** session whose workspace is a WSL UNC path is recomposed from its
  current mode to the matching WSL variant (`standard` → `wsl-standard`,
  `code` → `wsl-code`, …). Every creation path (this plugin's dialog, the
  workspace row's New Session, the hero picker) converges on the WSL-backed
  composition; the host only allows preset swaps on blank sessions.
- **Entry point**. A round icon button beside Settings at the sidebar foot
  (28px wide / 36px rail, official `sidebar.footer.action` slot) opens the
  dialog (distribution picker + Linux directory browse/input + validation)
  which creates the UNC workspace and starts a session.
- **Dual access**. Inside a WSL session the Windows filesystem is reachable
  and writable as `/mnt/<drive>` (e.g. `/mnt/c/Users/...`) from both bash
  and the file tools — migrating files is a cross-path read/write or a bash
  `cp`.

## Installation (web profile)

Pick one, then restart `dsh web`:

```powershell
# 1) Local directory (development / self-hosted)
dsh plugin --profile web add D:\path\to\dsh-wsl-workspace

# 2) GitHub repository (clone-to-install: the repo ships the prebuilt lib/,
#    no local build required)
dsh plugin --profile web add https://github.com/<user>/dsh-wsl-workspace

# 3) npm package (if published)
dsh plugin --profile web add dsh-wsl-workspace
```

After restarting `dsh web`, the WSL icon appears beside Settings at the
sidebar foot.

> **Note**: Git/npm installs land as a snapshot in the profile; after editing
> the plugin sources you must `add` again. For live development, junction the
> `node_modules` to the profile's node_modules and mount via
> `cordis.patch.yml` — the same pattern
> [dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal)
> documents.

## Development and building

This plugin is **designed to run inside DeepSeek Harness**: all
`@deepseek-ai/*` dependencies are resolved by the host at runtime
(peerDependencies), and the `lib/` build output is committed to the
repository (`dsh plugin add` runs no build).

- **Build** (after editing sources): requires a
  [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
  checkout as the surrounding environment (the tsconfig `paths` and tsdown
  externals point at its packages), then
  `node <checkout>/node_modules/tsdown/dist/run.mjs --config tsdown.config.ts`.
- **Typecheck**: `node <checkout>/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  (also needs the checkout's `lib/types`).
- **Tests** (need WSL installed):
  ```powershell
  node --import tsx/esm --test tests/paths.test.ts tests/variants.test.ts
  node --import tsx/esm tests/smoke.ts          # real-WSL integration smoke
  node tests/host-materialize.mjs               # preset-variant generation asserts
  ```
  During development `tests/` resolves `@deepseek-ai/*` through a `node_modules`
  junction to the host profile's dependency mirror
  (`$env:USERPROFILE\.dsh\profiles\node_modules`).

## Compatibility (official extension points used)

The plugin only uses official DeepSeek Harness extension points; no official
source is modified:

| Extension point | Purpose |
|---|---|
| `sidebar.footer.action` slot | sidebar-foot WSL button |
| `agentPresets` service (`list`/`read`) | enumerate source modes and read compositions to generate variants |
| `agentPreset.select` / session `agentPreset` field | blank-session mode mapping |
| `ctx.shellEnv` (`DSH_*` facts) | inject the session distribution into the executor (`DSH_WSL_DISTRO`) |
| `ctx.webServer.register` | dialog data route |
| preset roster + `isolate` realm | `wsl-<mode>` variant compositions |
| WSL 9P UNC filesystem (Node fs) | zero-install `fs-wsl` backend |

Verified against deepseek-harness `master` (current 0.1.0-rc era); upstream
changes to the seams above require matching adaptation.

## Usage

1. Click the WSL icon beside Settings at the sidebar foot.
2. Pick a distribution, browse/enter a Linux directory (e.g. `/home/me/proj`),
   and click "Create & open".
3. The new session runs in WSL: the `bash` tool executes inside WSL,
   `read/write/edit` operate on WSL files, paths are Linux-form; Windows files
   are reachable via `/mnt/<drive>`.

In a WSL workspace the mode picker still offers Standard/PTC/Minimal/
Creative — any mode automatically lands on its WSL variant (the picker also
shows "WSL · Standard" style entries directly, selectable by hand). Windows
local workspaces are unaffected and use the original modes. To keep the
official packages untouched, the mode picker does not filter by workspace
(picking a WSL variant in a local workspace routes bash through
`/mnt/<drive>` to the Windows filesystem).

## Configuration (variant files, no settings UI)

`<dshHome>/.agent-presets/wsl-*/agent.cordis.yml` is rewritten by the plugin
on every boot (managed file). Tunables live in the `shell-wsl` / `fs-wsl`
rows' `config`:

| Key | Default | Meaning |
|---|---|---|
| `distro` | none (taken from the workspace UNC) | fallback distribution, only when the workdir carries none |
| `wslPath` | `wsl.exe` | the wsl executable |
| `loginShell` | `true` | `-lc` login shell (loads nvm/cargo etc. profile PATHs) |
| `timeoutMs` / `maxTimeoutMs` / `maxOutputBytes` / `maxSpillBytes` / `graceMs` | same as `dsh-bash-local` | execution budgets |
| `fs-wsl.cwd` / `diffBasisMaxBytes` | none / 10MiB | fs base and diff cap |

The plugin row `wsl-workspace`'s `config`:

| Key | Default | Meaning |
|---|---|---|
| `route` | `/wsl-workspace/api` | dialog data route |

## Known limitations (v1)

- **Sessions that already produced output cannot swap composition**: the
  host only allows preset switches on **blank** sessions. An older session
  (created before the plugin, or still on the standard mode) whose workspace
  is a `\\wsl.localhost\...` UNC path cannot enumerate the share through the
  PowerShell provider (`GetNamedSecurityInfoW failed (Win32 1)` — the 9P
  share does not serve that Windows security API; **not a sandbox block**).
  The session's read/write/edit file tools (Node fs) still work, as do
  `cmd /c dir` and `wsl.exe -d <distro> ls`; the fix is to **create a new
  session** in that workspace. Sessions bound to the legacy standalone `wsl`
  preset likewise cannot resume after a restart (the preset was folded into
  the variant family) — recreate them.
- **Sandbox**: the Windows ACL sandbox cannot wrap `wsl.exe` (children run on
  the Linux kernel side). The WSL VM itself is the isolation boundary
  (`wsl-isolation` semantics); the `assumeWslIsolation` fail-closed switch is
  deferred to v2. Under `workspace-write + ask` permissions, WSL bash calls
  may trigger approval prompts — v1 targets `danger-full-access`
  (single-developer machines).
- **Process-tree termination**: killing the `wsl.exe` relay does not always
  terminate the whole process tree inside the distribution; background
  processes may linger briefly after timeout/interruption (same WSL semantics
  as `dsh-bash-terminal`).
- **No `grep` tool in WSL sessions**: `tool-fs-search`'s bundled ripgrep runs
  on the Windows side and cannot open Linux paths (reports "access denied,
  os error 5"), so every WSL variant drops it — search with bash
  `grep`/`rg` (runs inside WSL and works normally).
- **9P semantics**: stat version tokens derive from 9P metadata; very fast
  concurrent writes may falsely report `FS_STALE_VERSION`; listing large
  directories is slow (M5 plans a WSL-side thin helper for speed, keeping the
  UNC mode as fallback).
- **No interactive terminal (PTY)**: M3 milestone (ConPTY-wrapped
  `spawnTerminal`).

## Roadmap

M1 core loop (this release) → M2 sidebar file-tree panel (adapted from
dsh-side-panel, through the `ctx.fs` seam) → M3 interactive terminal → M4 SSH
remote workspaces (vpshub-style ledger) → M5 performance. See `DESIGN.md`
(Chinese) for the full design.

## License and attribution

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The NOTICE precisely
lists:

- **Adapted/inherited source code**: DeepSeek Harness (MIT) —
  `dsh-bash-local` (executor mechanics), `dsh-fs-local` (`WslFileSystem`
  subclasses it), shipped presets (read and transformed by the variant
  generator);
- **Design references (no source copied)**:
  [dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal) (MIT,
  wsl argv / WSLENV approach),
  [dsh-side-panel](https://github.com/ccq1/dsh-side-panel) (BSD-3-Clause,
  host-route pattern),
  [vpshub](https://github.com/Sdongmaker/vpshub) (MIT, roadmap reference).

Keep `LICENSE` and `NOTICE` when redistributing.
