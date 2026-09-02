# DSH release compatibility evidence

The `dsh.compatibility.dshReleases` records in `package.json` are backed by the
reproducible procedure in `scripts/verify-dsh-compat.sh`. Re-run it before
changing any declaration:

```powershell
$env:DSH_COMPAT_PLUGIN = (Resolve-Path .\dsh-wsl-workspace-0.4.2.tgz).Path
scripts/verify-dsh-compat.sh 0.1.0-rc.7 0.1.0-rc.8 0.1.1-rc.1 0.1.1-rc.2 0.1.2-alpha.2 0.1.2-alpha.3 0.1.2-alpha.4
```

## Method

For every declared release the script:

1. installs the published `@deepseek-ai/dsh@<version>` into an isolated temp
   prefix (never the live installation);
2. redirects `DSH_HOME` to a fresh temp tree and picks an unused port, so the
   live profile and the running harness are untouched;
3. runs `dsh plugin --profile web add <candidate-tarball>` (or the package
   name when `DSH_COMPAT_PLUGIN` is unset);
4. boots `dsh web --port <port>`, requires the web UI to serve (following the
   token-auth URL on releases that require it), the plugin's
   `POST /wsl-workspace/api` to answer `200`, and the boot log to be free of
   plugin errors;
5. runs `dsh plugin --profile web remove dsh-wsl-workspace`, boots again, and
   requires the plugin route to be gone (clean uninstall).

A release is declared `compatible` only when install, start, and uninstall all
hold. Any failure would be declared `unknown` together with the failing step.

## Results (2026-09-02, plugin 0.4.2 candidate, Windows 11 + WSL2 Ubuntu)

| DSH release | install | start (route 200, no plugin errors) | uninstall (route gone) | verdict |
|---|---|---|---|---|
| 0.1.0-rc.7 | ✔ | ✔ | ✔ (route 405) | compatible |
| 0.1.0-rc.8 | ✔ | ✔ | ✔ (route gone) | compatible |
| 0.1.1-rc.1 | ✔ | ✔ | ✔ | compatible |
| 0.1.1-rc.2 | ✔ | ✔ | ✔ | compatible |
| 0.1.2-alpha.2 | ✔ | ✔ | ✔ | compatible |
| 0.1.2-alpha.3 | ✔ | ✔ | ✔ | compatible |
| 0.1.2-alpha.4 | ✔ | ✔ | ✔ | compatible |

All seven boots produced logs without a single `dsh-wsl-workspace` error line;
the verification transcript (per-version `boot-with-plugin.log`,
`boot-without-plugin.log`, `plugin-add.log`, `plugin-remove.log`) is retained
in the runner's temp directory by the script and printed as a summary table of
`<version> PASS compatible` lines at the end.

## Browser acceptance

The candidate was also installed into a fresh isolated profile for every
declared DSH release and exercised through the visible web UI. In each release,
the test clicked **Continue** and **Configure later** when onboarding was shown,
then **Add WSL workspace…**, **Check**, and **Create & open** for
`Ubuntu:/home/mille/repro-ws-root`. It selected the workspace when the host UI
required a separate selection step. The resulting session used the WSL Standard
variant, and the mode picker was used to click all four WSL variants directly:

| DSH release | PTC | Minimal | Creator | Standard | browser warnings/errors |
|---|---|---|---|---|---|
| 0.1.0-rc.7 | ✔ | ✔ | ✔ | ✔ | 0 |
| 0.1.0-rc.8 | ✔ | ✔ | ✔ | ✔ | 0 |
| 0.1.1-rc.1 | ✔ | ✔ | ✔ | ✔ | 0 |
| 0.1.1-rc.2 | ✔ | ✔ | ✔ | ✔ | 0 |
| 0.1.2-alpha.2 | ✔ | ✔ | ✔ | ✔ | 0 |
| 0.1.2-alpha.3 | ✔ | ✔ | ✔ | ✔ | 0 |
| 0.1.2-alpha.4 | ✔ | ✔ | ✔ | ✔ | 0 |

On `0.1.2-alpha.4`, the final packed artifact received an additional mapping
test: each non-WSL base-mode menu item was clicked and the session converged to
the corresponding WSL variant in every case:

| clicked item | resulting session mode |
|---|---|
| PTC mode | WSL · PTC mode |
| Minimal mode | WSL · Minimal mode（极简模式） |
| Creator mode | WSL · Creator mode（创造模式） |
| Standard mode | WSL · Standard mode（标准模式） |

After both sequences, the page contained no alert and its captured browser log
contained zero warnings and zero errors. This includes the Creator-to-WSL-Creator
transition that previously collided while both presets briefly shared the
Cordis inspection providers during the host's atomic preset switch.
