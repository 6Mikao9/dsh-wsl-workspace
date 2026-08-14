# dsh-wsl-workspace

[中文](README.zh.md)

Add a WSL workspace from the DeepSeek Harness web GUI and run the whole agent session — bash commands and file reads/writes — inside a local WSL distribution with Linux paths. Nothing needs to be installed inside WSL.

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

Click the W button beside Settings at the sidebar foot to open the "Add WSL workspace" dialog. Pick a distribution from the list, then browse the directory tree or type an absolute Linux path (for example `/home/me/proj`) — use the Check button to verify the path exists before creating the workspace. The username field is optional: leave it empty to run commands as the distribution's default user, or name a Linux user of that distribution to run the session as that user instead (equivalent to `wsl.exe -u <username>`). The username only changes the bash tool's run identity — the file tools go through the Windows-side WSL share and are unaffected. Each workspace's username is kept in `<dshHome>/wsl-workspaces.json`; delete the entry (or recreate the workspace from the dialog) to return to the default user.

Click "Create & open" to start a new session in the workspace. In the new session the bash tool executes commands inside the chosen distribution and `read`/`write`/`edit` operate on WSL files, so every path the model sees is a Linux path. The mode picker keeps working as usual: Standard, PTC, Minimal and Creative each land on their WSL variant automatically, and Windows files stay reachable from inside the session under `/mnt/<drive>` (for example `/mnt/c/Users/...`).

License: MIT.
