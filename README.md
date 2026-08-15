# dsh-wsl-workspace

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

Click "Create & open" to start a new session in the workspace. In the new session the bash tool executes commands inside the chosen distribution and `read`/`write`/`edit` operate on WSL files, so every path the model sees is a Linux path. The mode picker keeps working as usual: Standard, PTC, Minimal and Creative each land on their WSL variant automatically (the WSL variant entries in the picker are bilingual, e.g. `WSL · Standard mode（标准模式）`), and Windows files stay reachable from inside the session under `/mnt/<drive>` (for example `/mnt/c/Users/...`).
![alt text](image-2.png)
## Behavior notes

- **bash tool**: runs inside the WSL distribution as the configured username (empty = the distro default user, often `root`), so it can read and write anywhere in the distro. The Windows ACL sandbox cannot wrap `wsl.exe` — its children run on the Linux kernel side — so WSL itself is the isolation boundary and the DSH file policy does not apply to bash.
- **File tools (`read`/`write`/`edit`)**: go through the Windows-side WSL 9P share and run under the DSH file policy. Under `workspace-write`, reads work anywhere but writes are restricted to the session workspace; switch the file policy to `danger-full-access` to also allow writes outside it. The username field does not affect the file tools.
- The garbled `localhost` port-forwarding banner `wsl.exe` prints to stderr when the distro was not running yet is harmless.

## License & attribution

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The NOTICE precisely lists:

- **Adapted/inherited source code**: DeepSeek Harness (MIT) — `dsh-bash-local` (executor mechanics), `dsh-fs-local` (`WslFileSystem` subclasses it), and the shipped agent presets (read and transformed by the variant generator);
- **Design references (no source copied)**: [dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal) (MIT, wsl argv / WSLENV approach), [dsh-side-panel](https://github.com/ccq1/dsh-side-panel) (BSD-3-Clause, host-route pattern), [vpshub](https://github.com/Sdongmaker/vpshub) (MIT, roadmap reference).

Keep `LICENSE` and `NOTICE` when redistributing.

## Acknowledgments

Special thanks to [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) (DSH Web 鲸鱼娘 skin series · 深海女仆工坊 maid-atelier, CC BY-NC-SA 4.0): the whale girl skin plugin brings a full set of adorable skins to the DeepSeek Harness Web UI and makes daily use of DSH a warmer experience.
