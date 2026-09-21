# dsh-wsl-workspace

[![dsh.so security](https://www.dsh.so/badge/dsh-wsl-workspace.svg)](https://www.dsh.so/artifact/dsh-wsl-workspace)
[![dsh.so install](https://www.dsh.so/badge/install/dsh-wsl-workspace.svg)](https://www.dsh.so/artifact/dsh-wsl-workspace)

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)
![alt text](image-3.png)
Add a WSL workspace from the DeepSeek Harness web GUI and run the whole agent session — bash commands and file reads/writes — inside a local WSL distribution with Linux paths. Nothing needs to be installed inside WSL. The session can reach both WSL and Windows at the same time: bash commands run inside the WSL distribution, while Windows files stay accessible via `/mnt/<drive>` (for example `/mnt/c/Users/...`).

## Install

Pick one of the three ways below, then restart `dsh web`:

```powershell
# 1) npm package
dsh plugin --profile web add dsh-wsl-workspace

# 2) GitHub repository (ships the prebuilt lib/, no local build required)
dsh plugin --profile web add https://github.com/6Mikao9/dsh-wsl-workspace

# 3) Local directory (development / self-hosted)
dsh plugin --profile web add D:\path\to\dsh-wsl-workspace
```

After restarting `dsh web`, a W button appears beside Settings at the sidebar foot.

## Usage

Click the W button beside Settings at the sidebar foot to open the "Add WSL workspace" dialog. Pick a distribution from the list, then browse the directory tree or type an absolute Linux path (for example `/home/me/proj`) — use the Check button to verify the path exists before creating the workspace. The dialog follows the DeepSeek Harness UI language. The username field is optional: leave it empty to run commands as the distribution's default user, or name a Linux user of that distribution to run the session as that user instead (equivalent to `wsl.exe -u <username>`). The username only changes the bash tool's run identity — the file tools go through the Windows-side WSL share and are unaffected. Each workspace's username is kept in `<dshHome>/wsl-workspaces.json`; delete the entry (or recreate the workspace from the dialog) to return to the default user.

Click "Create & open" to start a new session in the workspace. In the new session the bash tool executes commands inside the chosen distribution and `read`/`write`/`edit` operate on WSL files, so every path the model sees is a Linux path. The mode picker keeps working as usual: Standard, PTC, Minimal and Creative each land on their WSL variant automatically (the WSL variant entries in the picker are bilingual, e.g. `WSL · Standard mode（标准模式）`), and Windows files stay reachable from inside the session under `/mnt/<drive>` (for example `/mnt/c/Users/...`). The dialog's "?" button opens a panel with the DSH releases this build declares, how the plugin is used, and the limitations it cannot fix.
![alt text](image-2.png)
## Behavior notes

- **bash tool**: runs inside the WSL distribution as the configured username (empty = the distro default user, often `root`), so it can read and write anywhere in the distro. The Windows ACL sandbox cannot wrap `wsl.exe` — its children run on the Linux kernel side — so WSL itself is the isolation boundary and the DSH file policy does not apply to bash.
- **File tools (`read`/`write`/`edit`)**: go through the Windows-side WSL 9P share; the username field does not affect them. Two seams the host's own provider would supply are re-established inside the WSL world, because a variant mounts this plugin's `fs` provider in the preset's isolate realm where the host's `fs-sandbox` wrapper is not in the call path. **Symlinks**: the share lists a Linux link but cannot resolve it, so a link path used to look like a missing file; `resolve`/`lstat` now ask the distribution (`wsl.exe … readlink -f`) and continue at the real path, and a link is never replaced by a regular file. **The access mode**: `write`/`edit` are fenced by `ctx.sandboxPolicy` exactly as the host backend fences them — the same `writableRoots` allow-list (plus the distribution's `/tmp`, the temp area of the world the session runs in), the same `FS_SANDBOX_DENIED` the tool layer renders as a denial, and the same `sandboxMode` fact it reads for escalation. Because the fence runs after resolution it judges the real path: a link out of the workspace is an outside write and is denied under `workspace-write`. A deployment that mounts no policy service fences nothing, as on the host.
- **File search (`grep`/`glob`)**: the host's discovery suite spawns a packaged *Windows* ripgrep, so a WSL variant used to drop the row and leave the model to search through the shell. The world now mounts its own twin (`src/host/wsl-search.ts` → `lib/wsl-search.js`), which runs the search **inside the distribution**: the tool names, parameter schemas, caps, output schema (`Line N:` grouping, found-count header, capped-result footer), search cards and formatted-result spill all come from `@deepseek-ai/dsh-tool-fs-search`'s own exported pieces, so what the model sees matches the host. `grep` uses the distribution's GNU grep (`-rnIEH -Z`; POSIX ERE — `\d`, `\w`, `\b` and `(?i)` work, lookaround and backreferences do not), skips hidden files and directories plus `node_modules` like ripgrep's defaults do, does **not** read `.gitignore`, expands `{a,b}` into one `--include` per alternative, matches a `include` containing `/` in this process (ripgrep semantics), and fails loudly on a distribution without GNU grep rather than framing unreadable records. `glob` lists with GNU `find` (`-printf` gives each file's mtime without a stat per file) and matches gitignore-style patterns here (`*` never crosses a separator, `**` does, `?`, `[...]`, `{a,b}` and a leading `!` negation), ordering oldest-first exactly as `rg --sort=modified` does. Both search the Linux tree directly — symlinks, permissions and `.gitignore`-free traversal included — never the 9P share, both prune VCS metadata directories, and neither follows a symlink found during recursion, which is ripgrep's default too. Modes whose source preset mounts no search suite (Minimal) gain none.
- **Skill catalog**: the session's skill catalog is discovered starting at the session cwd's nearest `.git` ancestor (falling back to the cwd itself), then scanning downward for `.dsh/skills` / `.agents/skills` — including nested projects — bounded to 4 directory levels, 64 skill directories and 4096 visited directories. Register the workspace at the project root you work in; if the registered workspace itself sits inside a larger git repository, the scan starts at that repository's root (matching the host's own rule) and sibling projects may surface. A Linux symlink the Windows-side share cannot resolve is resolved through the distribution instead (`wsl.exe … readlink -f`, at most 32 per lookup, four in flight) and the walk continues at the real path, so a project linked in with `ln -s` — and nested projects below it — is discovered and deduplicated by that real path. Skill bodies always load live. The generated preset pins `watch: false` on the `skill-filesystem` row because watching a `\\wsl.localhost\...` path fails, so the plugin polls instead, in two passes. The cheap pass runs every 3 seconds over the skills directories it published and re-stats each skill file: an added, removed or **edited** skill therefore reaches the model's next turn, and an edit is why the stamp matters — the model's catalog is rebuilt only when the registry's revision moves, and a directory listing cannot tell a rewritten `SKILL.md` from an untouched one. The full re-discovery walk runs every 30 seconds, because only a walk can find a skills directory that did not exist before (a new nested project's first `.dsh/skills`, say). Neither pass re-reads a skill body.
- **Shell lifetime**: `bash` is a **stateful** shell — `cd`, exported variables, activated virtualenvs and background jobs survive between calls. The world mounts the host's PTY registry and its config-driven backend (`@deepseek-ai/dsh-terminal-bash`) pointed at this plugin's relay (`src/host/wsl-relay.ts` → `lib/wsl-relay.js`, run by the host's own node), which hands the PTY to `wsl.exe … bash`: the distribution comes from the session's UNC cwd (else `DSH_WSL_DISTRO`), the optional username from `DSH_WSL_USER`, and the relay runs `bash -lc 'cd … && exec bash -i'` so the login environment is loaded while the session directory survives (a plain `bash -l` can be sent to `$HOME` by a profile). That tool registers the `bash` name, so it replaces the one-shot `dsh-tool-bash` row a non-WSL preset would use — the world also provides its own no-op `sandbox` capability (`src/host/wsl-sandbox.ts`), because the host's Windows ACL runner cannot read a `\\wsl.localhost\…` path's security descriptor and the PTY backend confines through it before spawning. Both shells run inside the distribution and are outside the DSH file policy — WSL is their isolation boundary. **Two consequences of the host's own wrapping are stated in the tool's description** (which this plugin overrides, because the host default mentions neither): the shell is one process for the whole Agent, so a `cd` in one call decides where the next call starts — use absolute paths or an explicit `cd`; and the host wraps each command as `eval -- $'…'`, so a command ending in `&` backgrounds the *whole* wrapped command — the call then returns immediately with exit code 0 and no output while the real output arrives later, possibly inside the next call's. Write background work as `( long-job > log 2>&1 ) &` on its own line, or use the background-job tool.
- **Tracked background jobs**: `bash_background` starts one command in the background and returns a registry job id immediately; the host's `job_list`, `job_output` (incremental reads, status transitions, completion notices) and `job_kill` then work on it exactly as they do for the host's one-shot tool. The row exists because the persistent shell's schema declares only `command`: without a producer, `job_list` always answered "no background jobs" and a `run_in_background: true` argument passed to `bash` was silently ignored — the parameter schema does not forbid extra properties, so nothing reported the mistake. A real session found exactly that. The tool is mounted only alongside the persistent shell; a world that keeps the one-shot bash row already has `run_in_background` on that tool.
- **Older hosts fall back to a one-shot shell**: the persistent stack is the *host's* code, and on Windows it needs a platform process inspector that only exists from `0.1.0-rc.8` on — in `0.1.0-rc.7` `spawnTerminal` throws `subprocess-local: terminal inspection is unsupported on platform win32` before any process starts, so every `bash` call in that release fails outright (grep/glob, which never touch the PTY, keep working). The plugin therefore *probes* the substrate at startup instead of assuming: it hands `spawnTerminal` a program that cannot exist, which reaches the inspector check and nothing else — no process is created either way, and the rejection says which half failed. When the answer is "no inspector", the generated world keeps the one-shot `dsh-tool-bash` row (this plugin's own `ctx.shell` provider, no PTY) and the model gets a working, stateless shell instead of an error on every call. `0.1.0-rc.7` is the only declared release in that state; every later one gets the persistent shell.
- The garbled `localhost` port-forwarding banner `wsl.exe` prints to stderr when the distro was not running yet is harmless.

## Changelog

### 0.7.2 — 2026-09-21

- **The WSL skill catalog is no longer re-walked on the request path (issue #25).**
  The host rebuilds the catalog during a request and awaits each provider's
  `list()`, and this provider kept its own answer for only 10 s — so every time the
  catalog was re-collected (a new session or scope, or simply a lookup more than
  10 s after the last one) that request paid a full walk of the workspace, one
  directory at a time: two `stat`s and one `readdir` each. A `readdir` over the
  `\\wsl.localhost\…` 9P share measures 3-16 ms here and the walk's budget is 4096
  directories, which is why a large workspace cost 20.4 s, on the request path. A
  published catalog is now served as-is, and only the provider's own change detector
  can drop it: a repeat lookup costs 1-3 ms and no filesystem traffic. The freshness
  contract is unchanged — a new nested skills directory still appears within 30 s,
  and an added, removed or edited skill within 3 s.
- The walk itself is cheaper: one BFS layer is probed concurrently (bounded) and
  published in frontier order, so the catalog stays deterministic, and a
  directory's `.dsh/skills` / `.agents/skills` are probed only when its own listing
  showed that marker. The budget-sized walk went from 20.4 s to 4.8 s on the same
  machine; node's filesystem thread pool caps the real parallelism.

### 0.7.1 — 2026-09-20

- **`npm install dsh-wsl-workspace` no longer fails.** Verifying the published
  artifact turned up a regression this release introduced: npm auto-installs
  missing peer dependencies, and the `@deepseek-ai/dsh-tool-fs-search` peer added in
  0.6.0 itself peers on `@deepseek-ai/dsh-retention`, which is **not published** — so
  a plain `npm install` died with `E404 … @deepseek-ai/dsh-retention` (0.4.3 installs
  fine, so it was ours). `dsh plugin add` uses pnpm, which only *warns* about unmet
  peers, which is why every harness run and real install passed. All ten host peers
  are now marked optional in `peerDependenciesMeta`: the package still declares what
  the host must provide, but npm no longer tries to fetch it.

### 0.7.0 — 2026-09-20

The WSL world now matches the host everywhere a session can tell the difference,
and the last two known issues are closed. Everything below ships together: a WSL
variant gets Linux symlinks, the session's access mode, in-distribution search, a
live skill catalog, a stateful shell, and tracked background jobs.

- **The host's `bash` contract is stated in the tool description.** The persistent
  tool wraps each command as `eval -- $'…'`, so a command ending in `&` backgrounds
  the *whole* wrapped command — the call returns immediately with exit code 0 and
  no output while the real output arrives later, possibly inside the next call's.
  And the shell is one process for the whole Agent, so a `cd` carries into the next
  call. The host default says neither, and DSH's own Minimal preset recommends the
  hazardous form (`sleep 10 &`). The world now overrides `description` (a supported
  key on every declared release) with both facts and the safe forms.
- **`0.1.0-rc.7` falls back to a working one-shot shell.** That release's
  `dsh-subprocess-local` has no Windows process inspector, so the host's PTY-backed
  persistent shell cannot start on Windows at all — every `bash` call failed with
  `subprocess-local: terminal inspection is unsupported on platform win32` (the
  host ships the same gap: its Minimal preset mounts `persistent-bash` there with
  no Windows guard). The plugin now *probes* the substrate instead of assuming —
  it hands `spawnTerminal` a program that cannot exist, which reaches the inspector
  check and nothing else — and when the answer is no, the world keeps the one-shot
  `dsh-tool-bash` row: a working, stateless shell rather than an error per call.
- **Tracked background jobs, restored.** Replacing the one-shot bash tool with the
  persistent one also removed the only thing that started a registry job, so
  `job_list` always answered "no background jobs" and a `run_in_background: true`
  argument handed to `bash` was silently ignored (the parameter schema allows extra
  properties, so nothing complained). The world now mounts `bash_background`
  (`src/host/wsl-jobs.ts`), a thin producer over the host's own `ctx.jobs.start`
  plus this plugin's `ctx.shell.start`: it returns a job id, and
  `job_list`/`job_output`/`job_kill` work on it as usual. It is mounted only where
  the source mode also mounts the `job_*` tools, and only alongside the persistent
  shell.
- **Six defects found by hunting the new code with worst-case input**: a hidden-file
  guard that also applied to an explicitly named file (`grep path=.env` returned
  nothing), a discarded `find` exit status (`glob path=/nope-missing` looked like an
  empty directory), a line-terminated glob header (a root whose name contains a
  newline came back truncated), untranslated Windows paths (`grep path='D:\proj'`
  failed where `read` worked), a closed spill schema (which would have failed the
  tool's own output validation on every capped search), and a catalog detector that
  could stack polls on a slow share. Plus two in the new producer: it was mounted in
  a mode with no `job_*` tools to read its ids, and it defaulted a job's working
  directory to the host process's rather than the session workspace.
- **Verification**: thirteen checks on each of the eight declared releases
  (`0.1.0-rc.7` … `0.1.5-rc.2`) — `search-real` drives the real tools against a real
  distribution fixture — leaving only the two pre-existing baseline failures
  (`typecheck`, and `host-api` which needs a live server). 152 unit tests, including
  a parity check of every renderer against the host suite's own formatters. Real
  browser sessions on five releases for the tool behaviour, and a **frontend pass on
  all eight** (entry button, dialog, path check, create & open, mode picker, help
  panel with v0.7.0 and 8 release chips), with the session log as evidence for the
  tool set, the search results, the catalog replacement, the shell fallback and the
  background-job lifecycle.

### 0.6.0 — 2026-09-19

- **WSL sessions get `grep` and `glob`**: the host suite spawns the packaged Windows ripgrep and every path the model hands it is a Linux one, so the generated world dropped `tool-fs-search` and left the model to grep through the shell — the last bullet of the panel's known issues. The world now mounts an in-distribution twin that keeps the host suite's contract: the same tool names, parameter schemas, inline caps (250 matches / 100 paths), output schema, `Line N:` grouping, found-count header, capped-result footer, search card and formatted-result spill — the rendering comes from `@deepseek-ai/dsh-tool-fs-search`'s own exported formatters, and the two projections that package keeps private (the card metadata and the glob page) are reproduced and compared against it in unit tests. `grep` runs GNU grep inside the distribution (`-rnIEH -Z`, POSIX ERE, hidden entries and `node_modules` skipped like ripgrep's defaults, no `.gitignore` support), `glob` uses GNU `find` with in-process gitignore-style matching and ripgrep's oldest-first modification order. Model-controlled values travel as separate argv elements after a fixed script, so nothing the model types is ever parsed by a shell.
- **The skill catalog notices an edited skill, not just an added one**: the catalog message is rebuilt only when the registry's revision moves, and the old detector compared directory listings — so rewriting an existing `SKILL.md` (a description, say) changed nothing it could see and the model kept the old text until a new session. The cheap pass now also stamps every skill file with its modification time and size, and runs every 3 seconds instead of 10. The full re-discovery walk — the only pass that can find a skills directory that did not exist before — moved to its own 30-second cadence, so the change detection is both faster and cheaper than the single 10-second poll it replaces.
- **`lib/` is rebuilt deterministically**: `tsdown` writes into a committed `lib/`, and stale code-split chunks from an earlier build survived every rebuild (`clean: false` plus two configurations sharing one output directory). Local build tooling now clears the directory first, and the three new runtime peers (`@deepseek-ai/dsh-tool-fs-search`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/schemastery`) are declared, which is also what keeps them external instead of bundling a second copy of DSH's tool stack into this plugin.
- **Four defects found by hunting the new code with worst-case input**: a hidden-file guard that also applied to an explicitly named file (`grep path=.env` returned nothing), a discarded `find` exit status (`glob path=/nope-missing` looked like an empty directory), a line-terminated glob header (a root whose name contains a newline came back truncated) and untranslated Windows paths (`grep path='D:\proj'` failed where `read` worked). The spill schema was also closed, which would have failed the tool's own output validation on every capped search, and the catalog detector gained an in-flight guard so a slow poll cannot stack `wsl.exe` calls.
- **The host's `bash` wrapper is documented in the tool description**: the persistent tool wraps each command as `eval -- $'…'`, so a trailing `&` backgrounds the whole wrapped command and the call reports exit code 0 with no output; and the shell is one process, so a `cd` carries into the next call. The host default says neither, and DSH's own Minimal preset recommends `sleep 10 &` — the world now overrides the description with both facts and the safe forms.
- **`0.1.0-rc.7` no longer gets a broken shell**: that release's `dsh-subprocess-local` has no Windows process inspector, so the host's PTY-backed persistent shell cannot start on Windows at all (the host ships the same gap: its Minimal preset mounts `persistent-bash` there with no Windows guard). The world probes the substrate at startup and, when the answer is no, keeps the one-shot `bash` row — a working stateless shell — instead of failing every call. Verified by a real session on that release.
- **Tracked background jobs are back in WSL sessions**: replacing the one-shot bash tool with the persistent one also removed the only thing that started a registry job, so `job_list` always said "no background jobs" and `run_in_background: true` handed to `bash` was silently ignored (the parameter schema allows extra properties, so nothing complained) — the exact defect an operator's session surfaced. The world now mounts `bash_background` (`src/host/wsl-jobs.ts`), a thin producer over the host's own `ctx.jobs.start` + this plugin's `ctx.shell.start`: the tool returns a job id, and `job_list`/`job_output`/`job_kill` work on it as usual. Verified in a real session: `started background job bash-1` → `job_list` shows `running` → incremental `job_output` reads (`tick 1`, `tick 2`, then `tick 3`) → `[status: completed, exit code: 0]` plus the runtime's completion notice.
- **Verification**: thirteen checks on each of the eight declared releases (`0.1.0-rc.7` … `0.1.5-rc.2`) — `search-real` joins the suite, driving the real tools against a real distribution fixture (framing, includes and braces, caps and footers, spill, cards, error codes, argv-safety, explicit dot-files, unreadable roots, odd root names, `/mnt` paths, abort and overflow, glob ordering and pruning) — leaving only the two pre-existing baseline failures (`typecheck`, and `host-api` which needs a live server). Unit tests add `tests/wsl-search.test.ts` (33 cases) and the refresh, cadence, stacking and description cases; `skills-real` proves an edited skill file invalidates the catalog through the share's own modification times. Real browser sessions on five releases confirm the behaviour end to end, including the `0.1.0-rc.7` fallback.

### 0.5.0 — 2026-09-19

- **The file tools now follow Linux symlinks**: the `\\wsl.localhost` share lists a link entry but cannot describe it — `lstat`, `stat` and `readFile` on the link all fail and `resolve()` hands back a lexical identity for it — so a link path behaved like a missing file and a linked-in project's files could not be read or written at all. `resolve`/`lstat` now ask the distribution (`wsl.exe … readlink -f`, the same resolver the skill scan uses) whenever this share cannot already describe the path, and continue at the real path. A link is never replaced by a regular file, and writing through a dangling link creates its target while keeping the link.
- **The access mode constrains a WSL session again**: a variant mounts its own `fs` provider in the preset's isolate realm, so the host's `fs-sandbox` wrapper was not in the call path and `workspace-write` did not stop a write outside the workspace (measured before the fix: a Linux path and a `D:\...` path both went through). `writeText`/`editText` now fence the mutation exactly as `@deepseek-ai/dsh-fs-sandbox` does: `ctx.sandboxPolicy` (the tool layer's per-call value, else the service), the same `writableRoots` allow-list plus the distribution's `/tmp`, the same `FS_SANDBOX_DENIED`, and the `sandboxMode` getter the tool reads to advertise escalation. Because the fence runs after link resolution it judges the real path, so a link out of the workspace is an outside write.
- **Live skill catalog**: with `watch: false` pinned on the UNC-hostile watcher, a skill added while a session ran only appeared in the next session. The provider now keeps a change detector per scan root it has served, re-checking the published directory shape every 10 s (roots plus entry names and kinds, never re-reading skill files) and calling `control.invalidate()` when it changed, which makes the catalog middleware re-collect on the session's next turn.
- **`bash` is now a stateful WSL shell** — the capability the per-mode matrix kept showing was missing (every `bash` call used to be a fresh process). DSH's PTY registry takes replaceable backends and `@deepseek-ai/dsh-terminal-bash` is a config-driven one, so the world mounts it (inside its own `persistent-shell` group, because the registry is an agent-owned service) with `backendType: wsl` and points it at this plugin's relay (`src/host/wsl-relay.ts` → `lib/wsl-relay.js`) run by the host's own node. The relay resolves the distribution (session UNC cwd → `DSH_WSL_DISTRO` → host default) and the optional `DSH_WSL_USER`, then hands its stdio — the PTY — to `wsl.exe -d … --cd … -e bash -lc 'cd … && exec bash -i'`: login environment, interactive, and the session directory preserved. `@deepseek-ai/dsh-tool-bash-persistent` registers the **`bash`** name, so it takes the place of the one-shot `dsh-tool-bash` row (mounting both fails the whole preset — the same collision DSH's Minimal mode sidesteps by being a persistent-shell-only agent). The world also isolates and provides its own no-op `sandbox` capability: the PTY backend confines through `ctx.sandbox` before spawning, and the host's Windows runner cannot read the security descriptor of a `\\wsl.localhost\…` workspace root (`GetNamedSecurityInfoW failed (Win32 1)`), so a WSL session declares `enforcement: 'partial'` and keeps the policy where it is meaningful — in the file tools.
- **Verification**: the eight declared releases (`0.1.0-rc.7` … `0.1.5-rc.2`) run twelve harness checks — `fs-real` (link resolution through the real backend, reads through links and chains, dangling-link creation, link preservation, the fence on an outside link target, the distro `/tmp` allowance) and `relay-real` (stateful shell against real WSL, distribution and user resolution, clean exit) are new — with the same two documented baseline failures (`typecheck`, and `host-api` needing a live server). Unit: `tests/fs-policy.test.ts` (7 fence cases) and the skill-provider refresh cases, on top of the existing suite.

### 0.4.5 — 2026-09-19

- **A project linked into a WSL workspace is discoverable now**: the `\\wsl.localhost` 9P share lists a Linux symlink but cannot resolve its target, so the skill scan — which already followed directory links on substrates that resolve them — skipped every linked-in project, and with it every nested project below it (the layout issue [#10](https://github.com/6Mikao9/dsh-wsl-workspace/issues/10) describes). When the share reports a link it cannot follow, the provider now asks the distribution itself (`wsl.exe -d <distro> -- readlink -f <linux path>`) and continues the walk at the real path. The fallback is bounded on purpose: at most 32 links per lookup, four calls in flight, a 10 s timeout each, and the existing depth / visited-directory / skill-directory budgets are untouched. Because the walk continues at the resolved path, a project reachable both directly and through a link is visited once, and a link that points back at the workspace root is absorbed by the visited set instead of looping.
- **What the fallback does not cover**: `read/write/edit` still resolve their paths through `WslFileSystem`, which does not follow Linux links, so reading or writing a link path reports it missing — use the real path. The help panel's known-issues list now states that instead of promising a fallback "not implemented yet".
- **Why one `wsl.exe` per link** (measured, and worth recording): `wsl.exe` silently drops the arguments that follow a command (`sh -c 'echo $#' sh a b c` answers 0), and its command-line parser truncates an argument containing a double quote, so a batched `sh` loop cannot be made reliable through it. A bare `readlink -f a b c` is no better: GNU `readlink` stops at the first path it cannot resolve and still exits non-zero, which would silently starve the rest of the batch. Passing each path as a process argument to one short call avoids quoting entirely — paths with spaces, quotes and backslashes all resolve — at the cost of one process per link (about 35 ms warm; six links cost 179 ms end to end on this machine, and a workspace with no links never starts a distribution process at all).
- **Verification**: the eight declared releases (`0.1.0-rc.7` … `0.1.5-rc.2`) pass the same 8/10 harness checks as 0.4.4 — only the documented `typecheck` baseline and the check that needs a live server fail. The real-9P check now builds a fixture whose only path in is a symlink and asserts the linked project, its nested project and its service through `get()`; the same walk with the fallback face removed finds neither, which is the pre-fix behaviour reproduced in the same run. On a live WSL fixture (`/home/mille/symprobe/ws`: a link out of the workspace, a link chain, a file link, a dangling link and a loop back to the root) the catalog went from 2 skills to 5, and `get()` read every body through the resolved locator.

### 0.4.4 — 2026-09-19

- **A preset built on top of a WSL variant could not be used at all**: this generator recognises its own output by id prefix (`wsl-`), so a user preset that started life as a copy of `wsl-standard` or `wsl-cordis` — a "data mode" that carries its own world, say — was treated as a plain source preset and had a *second* world group appended to it. DSH refuses a composition carrying two `wsl-world` rows, so choosing that mode failed outright with `无法切换到「WSL · <name>」：duplicate loader entry id: wsl-world`; on a release that mounts the group before validating row ids the same duplication surfaces one step later as `tool "str replace editor" is already registered in this scope` (the report in [#24](https://github.com/6Mikao9/dsh-wsl-workspace/pull/24)). The generator now replaces the world group it finds — identified by the mounted `shell-wsl`/`fs-wsl` provider ids, so a copy whose group was renamed is caught too — and every variant ends up with exactly one world pointing at this installation's providers. A top-level row id that appears twice in a source is reduced to its first occurrence as well, because DSH rejects the whole preset on a duplicate id rather than the offending row.
- **`tool-str-replace-editor` rows are replaced like the older `str-replace-editor` row** ([#24](https://github.com/6Mikao9/dsh-wsl-workspace/pull/24)): newer rosters name the editor row that way, and it registers the same `str_replace_editor` tool as the world group's own editor row, so the source row is dropped just like its predecessor and the WSL-aware editor the variant injects stays.
- **Variant display names are no longer double-quoted**: the variant's `preset.yml` copied the source's `name:` scalar verbatim, so a quoted `name: 'Data mode'` reached the mode picker as `WSL · ''Data mode''`. The scalar is unquoted before it is re-emitted.
- **Not adopted from [#24](https://github.com/6Mikao9/dsh-wsl-workspace/pull/24)**: disabling the `tool-cordis` row to avoid a duplicate inspect-provider registration. A `disabled` row never applies, so the WSL variant of Creator mode silently lost `cordis_inspect_list` / `cordis_inspect_query` (checked against 0.4.3, where both are present and answer with the host and the client providers); the PR's own description that the model "can still see the tools in the catalog" is not what happens. The registration their report shows needs that row applied twice, which the row-id reduction above now prevents where a copied preset caused it.
- **Help panel tidied up**: the panel now opens with a greeting line and the repository link, carries a "What's new" section for this build, and lists only the limitations that still apply — the historical "fixed in 0.4.3" note and the per-generation API walkthrough are gone. The compatibility chips are untouched: they are the manifest this build declares, not history.
- **Verification**: the eight declared releases (`0.1.0-rc.7` … `0.1.5-rc.2`) pass the same 8/10 harness checks as 0.4.3 — only the documented `typecheck` baseline and the check that needs a live server fail; 136 transforms over every shipped preset of the 17 installed runtimes are unchanged apart from the repair, and all 68 "copied variant" cases resolve to a single fresh world group.
- **Per-mode matrix with a real model** (every WSL variant, not just the default one): on `0.1.0-rc.7`, `0.1.1-rc.2`, `0.1.3-alpha.2` and `0.1.5-rc.2` each of the four variants — Standard, PTC, Minimal, Creator — was driven through the browser and asked to write a file with its file tool, run `uname -r; pwd; whoami` in bash and land that output in the workspace, then read the file back. Every mode produced `MODE-<mode>-OK` and a WSL2 kernel line in `/home/mille/<workspace>/notes/` with no loader error; the follow-up bash call lands in the workspace again, which is the documented per-call shell (the PTY group stays dropped). `0.1.2-rc.1` and `0.1.5-rc.1` were driven through all four modes without the file/bash assertions.
- Browser + real-model spot checks of the copied-variant mode (mounts and answers), Creator mode (inspect tools intact) and the `0.1.0-rc.7` standard flow complete the pass.

### 0.4.3 — 2026-09-11

- **The persona text moved in `0.1.3-alpha.2`** ([#22](https://github.com/6Mikao9/dsh-wsl-workspace/issues/22)): DSH renamed the persona's model-facing scalar from `text` to an inline `suffix` plus a folded `prefix`, and the variant generator only recognised `text: >-`. On that line the WSL environment sentence was never appended - the session still ran inside the distribution, but the model was never told that its working directory is a Linux path reachable from Windows as `/mnt/<drive>`. The generator now amends `suffix`, `text` or `prefix` (folding an inline scalar into a block scalar when needed, so the sentence joins the working-directory line exactly where the legacy `text` block put it), and a persona carrying `complete: true` is still left alone. Verified on seven releases: the five older ones keep their persona block byte-identical, and the two newer ones now carry the sentence into the model's system message.
- **Help panel**: the dialog gained a "?" button that opens an in-place panel - the DSH releases this build declares (read from `package.json` through the host route, so the list can never drift from the manifest), how the plugin is used, its features, and the limitations it cannot fix.
- **The skill catalog now reaches UNC workspaces**: the host skill provider watches a workspace through `chokidar`, and watching a `\\wsl.localhost\...` path fails; the failed watcher makes the skill snapshot report `complete: false`, and `dsh-tool-skill` withholds the *entire* catalog message while a snapshot is incomplete — so a WSL session's model saw no skills at all, not even the ones the plugin had discovered. The variant generator now pins `watch: false` on the `skill-filesystem` row (merged into an existing `config:` block when there is one, and left alone when the source declares `watch` itself), which makes the host collect the catalog once at session start instead. Verified end to end on `0.1.5-rc.2`: the model's context carries the `<available_skills>` list. Trade-off: a skill added mid-session appears in the next session rather than the running one; skill bodies are still read live.
- **`verify-lib` hardening**: its comment/string stripper could pair a lone apostrophe inside a comment with a later one and swallow the rest of the bundle, which made every `node:*` import look tree-shaken. The quote rules now stop at a newline, exactly as a JavaScript string does.

### 0.4.2 — 2026-09-10

- **Create & open in a `0.1.2-rc.1` workspace**: the session starter is now resolved when the dialog writes, not when the plugin applies. This plugin applies *before* the UI domain that publishes `uiWorkspace` registers its service, so the lookup cached at apply time stayed `undefined` for the whole page life: `Create & open` created the workspace and then silently opened no session, leaving `sessionIds` empty while the dialog reported success. A release exposing neither `uiWorkspace.startSession` nor `workspaces.startSession` now fails *before* anything is written, instead of leaving an orphaned workspace behind.
- **Skill body integrity**: skill bodies no longer lose their first character. `findFrontmatterEnd` already returns the index of the body's first character (the closing delimiter's newline plus one), so the slice must start there; the previous offset dropped that character and made the one after the delimiter look like the body. The existing fixtures always put a blank line after the delimiter, which is exactly what hid it.
- **UTF-8 BOM skills are no longer dropped**: a `SKILL.md` saved with a leading BOM (Notepad, VS Code's "UTF-8 with BOM", PowerShell redirection) did not match the opening `---` and disappeared from the catalog entirely. The parser strips the BOM before the fence check.
- **Binding converges on late inputs**: the agent-preset roster and the registered `/mnt/<drive>` workspace set are both inputs to binding, and both land asynchronously after the plugin's first pass. Each now re-runs the pass when it arrives instead of waiting for a session-store event that may never come.
- **Compatibility manifest corrected**: `0.1.3-alpha.1` is not published (`npm view @deepseek-ai/dsh@0.1.3-alpha.1` is a 404), so the declaration could never be verified; it is replaced by the published `0.1.3-alpha.2`.
- **Reproducible publishes**: a new `.gitattributes` (`* text=auto eol=lf`, `lib/** -text`) pins line endings. `core.autocrlf=true` used to rewrite text files to CRLF on checkout, and since `lib/` is committed and published verbatim the same commit produced different npm tarballs depending on the machine; the repository already stored LF, so no renormalisation was needed.
- **Closed-loop tests**: `tests/client-lifecycle.test.mjs` drives the browser half through the shipped `lib/client.js` for both service shapes — legacy (`connection.api.agentPresets` + `workspaces.startSession`) and current (`remote.agentPresets` + `uiWorkspace`) — and asserts `Create & open` for the normal, late-registration and no-starter cases. The skill tests now cover a body that starts on the delimiter's next line, for LF and CRLF files.

### 0.4.1 — 2026-09-03

- **DSH v0.1.2-rc.1 compatibility**: Added backward compatibility support for DSH v0.1.2-rc.1 and later versions through feature detection and compatibility wrappers. The plugin now automatically detects the DSH version at runtime and uses the appropriate API:
  - `uiWorkspace.startSession()` for v0.1.2-rc.1+
  - `workspaces.startSession()` for v0.1.1-rc.2 and earlier
  - `summary.projectionValues?.agentPreset` for v0.1.2-rc.1+
  - `summary.agentPreset` for v0.1.1-rc.2 and earlier
  - Projection-based auto-sync for v0.1.2-rc.1+
  - `sessions.noteAgentPreset()` for v0.1.1-rc.2 and earlier
- **Updated compatibility manifest**: Added v0.1.2-rc.1 to the `dsh.compatibility.dshReleases` declaration.
- **Fixed `without inject` crash on v0.1.2-rc.1+**: the agent-preset roster is read through the `remote.agentPresets` namespace service via `ctx.get('remote.agentPresets')` (topology-free store lookup) instead of the `remote` aggregate's `agentPresets` property, which Cordis' associate proxy rejects when the dotted property is not declared in `inject`. `inject` stays limited to the services both DSH generations share (`slots`, `locale`, `sessions`, `workspaces`).
- **Compatibility manifest**: declared v0.1.3-alpha.1 compatible (its plugin-facing API surface matches v0.1.2-rc.1). Final adaptation notes consolidated in `docs/COMPATIBILITY_SUMMARY.md` (supersedes the root-level draft plans).

### 0.4.0 — 2026-08-29

Follow-ups from the [#12](https://github.com/6Mikao9/dsh-wsl-workspace/issues/12) limitation list and the [#13](https://github.com/6Mikao9/dsh-wsl-workspace/issues/13) compatibility work:

- **Lookup cache**: completed skill-catalog lookups are cached per scan root for 10 seconds, so repeated catalog builds no longer rescan the workspace over the slow 9P share; `get()` keeps reading skill bodies live, and freshly added skills appear within the TTL window.
- **Symlinked projects — investigated in 0.4.0, resolved in 0.4.5**: the discovery walk now recognizes directory symlinks explicitly and prunes them safely (no crashes, no loops), and the probe showed that following them is impossible over the `\\wsl.localhost` share itself (the Windows side cannot resolve Linux symlink targets: `readlink` → `EISDIR`, `stat`/`readdir` → `ENOENT`); 0.4.5 resolves them through the distribution instead, so linked-in projects are discoverable (see that changelog entry). A name+body fingerprint dedupe also guarantees aliased skill files can never publish twice on substrates that do resolve links.
- **Block-scalar frontmatter**: `description:` / `whenToUse:` written as YAML block scalars (`|` literal, `>` folded) now parse — such skills were silently dropped before.
- **Compatibility manifest**: `dsh.compatibility.dshReleases` declares per-release compatibility with the official DSH versions, backed by reproducible disposable-Profile install/start/uninstall evidence (`scripts/verify-dsh-compat.sh`), and `engines` declares the Node.js floor.
- **Guard scripts**: `scripts/check-rank-parity.mjs` fails the release when the copied project-rank constants drift from the host's `dsh-skill-filesystem`.

### 0.3.2 — 2026-08-29

- **WSL workspace sessions now inject nested-project skill catalogs** ([#10](https://github.com/6Mikao9/dsh-wsl-workspace/issues/10)): `.dsh/skills` and `.agents/skills` directories of projects nested below the registered workspace root are discovered and published with the host's project ranks and sources, so the model sees the same skill catalog it would see when the session cwd is the project folder itself. Discovery is depth- and budget-bounded, prunes `node_modules`/dot-directories, and leaves non-WSL sessions untouched.
- **Host-parity scan root**: lookups from inside a project subtree resolve the nearest `.git` ancestor first, so the enclosing project's skills stay visible from deeper cwds; skills above that ancestor do not leak.
- **Hardening**: the skill-root budget is enforced per push, and the `skills.registerProvider` call is guarded so a host whose `skills` service has a different shape can no longer break plugin load.
- **Housekeeping**: removed stale prebuilt `lib/` chunks that shipped dead vendor code (including an inlined schemastery copy that triggered dsh.so's `new Function` static rule); added `scripts/repro-setup.sh` plus a nested skill-catalog regression suite, and a matching TESTING.md section.

## License & attribution

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The NOTICE precisely lists:

- **Adapted/inherited source code**: DeepSeek Harness (MIT) — `dsh-bash-local` (executor mechanics), `dsh-fs-local` (`WslFileSystem` subclasses it), and the shipped agent presets (read and transformed by the variant generator);
- **Design references (no source copied)**: [dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal) (MIT, wsl argv / WSLENV approach), [dsh-side-panel](https://github.com/ccq1/dsh-side-panel) (BSD-3-Clause, host-route pattern), [vpshub](https://github.com/Sdongmaker/vpshub) (MIT, roadmap reference).

Keep `LICENSE` and `NOTICE` when redistributing.

## Acknowledgments

Special thanks to [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) (DSH Web 鲸鱼娘 skin series · 深海女仆工坊 maid-atelier, CC BY-NC-SA 4.0): the whale girl skin plugin brings a full set of adorable skins to the DeepSeek Harness Web UI and makes daily use of DSH a warmer experience.
