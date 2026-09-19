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
- **File tools (`read`/`write`/`edit`)**: go through the Windows-side WSL 9P share and run under the DSH file policy. Under `workspace-write`, reads work anywhere but writes are restricted to the session workspace; switch the file policy to `danger-full-access` to also allow writes outside it. The username field does not affect the file tools.
- **Skill catalog**: the session's skill catalog is discovered starting at the session cwd's nearest `.git` ancestor (falling back to the cwd itself), then scanning downward for `.dsh/skills` / `.agents/skills` — including nested projects — bounded to 4 directory levels, 64 skill directories and 4096 visited directories. Register the workspace at the project root you work in; if the registered workspace itself sits inside a larger git repository, the scan starts at that repository's root (matching the host's own rule) and sibling projects may surface. Results are cached for 10 seconds per scan root, so freshly added skills appear within that window; skill bodies always load live. One substrate limit to know: the Windows-side `\\wsl.localhost` share cannot resolve Linux symlinks (they read back as unresolvable entries), so a project linked into the workspace via `ln -s` is not discoverable — the scan walks past it without failing; register the workspace at a level that contains the real project directories instead. **Fixed in 0.4.3:** a UNC workspace used to deliver *no* catalog at all. The host skill provider watches the workspace with `fs.watch`, which fails with `EISDIR` on `\\wsl.localhost\...`; that observation is then reported incomplete and `dsh-tool-skill` withholds the whole catalog message while a snapshot is incomplete. The generated preset therefore pins `watch: false` on the `skill-filesystem` row, so the catalog is scanned once at session start and injected as usual. The only trade-off is live refresh: a skill added while a session is running shows up in the next session, not in the running one (skill bodies are still read live by `get`).
- The garbled `localhost` port-forwarding banner `wsl.exe` prints to stderr when the distro was not running yet is harmless.

## Changelog

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
- **Symlinked projects — investigated, substrate-limited**: the discovery walk now recognizes directory symlinks explicitly and prunes them safely (no crashes, no loops). Following them is not possible over the `\\wsl.localhost` 9P share — the Windows side cannot resolve Linux symlink targets (probed: `readlink` → `EISDIR`, `stat`/`readdir` → `ENOENT`) — so a project linked into the workspace via `ln -s` stays undiscoverable; a name+body fingerprint dedupe also guarantees aliased skill files can never publish twice on substrates that do resolve links.
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
