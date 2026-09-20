# dsh-wsl-workspace

[![dsh.so security](https://www.dsh.so/badge/dsh-wsl-workspace.svg)](https://www.dsh.so/artifact/dsh-wsl-workspace)
[![dsh.so install](https://www.dsh.so/badge/install/dsh-wsl-workspace.svg)](https://www.dsh.so/artifact/dsh-wsl-workspace)

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)
![alt text](image-3.png)
在 DeepSeek Harness Web GUI 中「添加 WSL 工作区」：让 agent 会话的 bash 命令与文件读写都运行在本机 WSL 发行版里，路径均为 Linux 形式，WSL 内无需安装任何工具链。会话可同时访问 WSL 与 Windows 两个系统——bash 命令在 WSL 发行版内执行，Windows 文件随时可通过 `/mnt/<drive>`（如 `/mnt/c/Users/...`）访问。

## 安装

三种方式任选其一，然后重启 `dsh web`：

```powershell
# 1) npm 包
dsh plugin --profile web add dsh-wsl-workspace

# 2) GitHub 仓库（仓库内已含预构建 lib/，无需本地构建）
dsh plugin --profile web add https://github.com/6Mikao9/dsh-wsl-workspace

# 3) 本地目录（开发/自用）
dsh plugin --profile web add D:\path\to\dsh-wsl-workspace
```

重启 `dsh web` 后，侧栏底部 Settings 旁出现 W 按钮。

## 使用
点侧栏底部 Settings 旁的 W 按钮，打开「添加 WSL 工作区」对话框。先从下拉框选择一个发行版，再浏览目录树或直接输入 Linux 绝对路径（如 `/home/me/proj`），可以点「检查」确认路径存在。对话框文案跟随 DSH 界面语言。用户名是可选项：留空则以该发行版的默认用户运行，填写该发行版里的某个 Linux 用户名则以该用户运行（等价于 `wsl.exe -u <用户名>`）。用户名只影响 bash 命令的运行身份，文件工具通过 Windows 侧的 WSL 共享访问、不受其影响；每个工作区填写的用户名保存在 `<dshHome>/wsl-workspaces.json`，删除对应条目（或重开对话框重建工作区）即可恢复默认用户。

点「创建并打开」后，新会话随即运行在 WSL：`bash` 工具在所选发行版内执行命令，`read`/`write`/`edit` 读写 WSL 文件，模型看到的所有路径都是 Linux 形式。模式选择器照常可用——标准、PTC、极简、创造都会自动落到对应的 WSL 变体（选择器里的 WSL 变体条目为中英双语，如 `WSL · Standard mode（标准模式）`）；会话内仍可通过 `/mnt/<drive>`（如 `/mnt/c/Users/...`）访问 Windows 文件。对话框右上角的「?」按钮会展开一页说明：这份构建声明兼容的 DSH 版本、插件的用法与特性，以及它无法绕过的已知限制。
![alt text](image-2.png)
## 行为与权限说明

- **bash 工具**：以配置的用户名在 WSL 发行版内运行（留空 = 发行版默认用户，通常为 root），可对发行版内任意路径读写。Windows 的 ACL 沙箱无法包裹 `wsl.exe`（子进程运行在 Linux 内核侧），WSL 自身即隔离边界，DSH 文件策略不作用于 bash。
- **文件工具（read/write/edit）**：经 Windows 侧的 WSL 9P 共享访问；用户名设置不影响它们。宿主原本会提供的两处能力，现在由 WSL 世界自己在内部补上——变体在预设的 isolate realm 里挂自己的 `fs` 提供者，宿主的 `fs-sandbox` 包装层不在调用路径上。**符号链接**：共享只列得出链接、解不开目标，链接路径以前会被当成不存在的文件；现在 `resolve`/`lstat` 会向发行版问一次真实路径（`wsl.exe … readlink -f`）并从那里继续，链接本身绝不会被普通文件替换。**访问模式**：`write`/`edit` 完全按宿主后端的做法由 `ctx.sandboxPolicy` 围栏——同一份 `writableRoots` 白名单（另加发行版的 `/tmp`，即会话所在世界的临时区）、同样的 `FS_SANDBOX_DENIED`（工具层会渲染成拒绝）、同样的 `sandboxMode`（工具据此声明升级）。由于围栏在解析之后执行，判定的是真实路径：链接指向工作区外就按工作区外处理，`workspace-write` 下会被拒绝。完全没有策略服务的部署则不围栏，与宿主一致。
- **文件搜索（grep / glob）**：宿主的搜索套件驱动的是打包进来的 **Windows** ripgrep，模型交给它的路径却全是 Linux 路径，所以 WSL 变体一直把这一行丢掉、让模型自己在 shell 里搜。现在世界挂上自己的同类实现（`src/host/wsl-search.ts` → `lib/wsl-search.js`），搜索**在发行版内**执行：工具名、参数 schema、条数上限、输出 schema（`Line N:` 分组、命中数表头、超限尾部提示）、搜索卡片与超限结果落盘全部沿用 `@deepseek-ai/dsh-tool-fs-search` 自己导出的部件，所以模型看到的东西与宿主一致。`grep` 用发行版自带的 GNU grep（`-rnIEH -Z`，POSIX ERE：`\d`、`\w`、`\b`、`(?i)` 可用，环视与反向引用不支持），像 ripgrep 默认那样跳过隐藏文件/目录与 `node_modules`，**不读 `.gitignore`**，`{a,b}` 会展开成多个 `--include`，含 `/` 的 include 在插件进程里按相对路径匹配（ripgrep 语义）；发行版没有 GNU grep 时明确报错，而不是给出错位的记录。`glob` 用 GNU `find` 列出文件（`-printf` 直接带出修改时间，不必逐个 stat），在插件里按 gitignore 风格匹配（`*` 不跨分隔符、`**` 跨、`?`、`[...]`、`{a,b}`，前导 `!` 取反），并按修改时间从旧到新排序——与 `rg --sort=modified` 一致。两者都直接搜 Linux 真实目录（符号链接、权限、不理会忽略规则），不走 9P 共享；都跳过版本库目录，也都不跟进递归中遇到的符号链接（同样是 ripgrep 的默认）。源预设没有搜索套件的模式（极简）不会凭空多出这两个工具。
- **技能目录（skill catalog）**：从会话 cwd 最近的 `.git` 祖先开始（没有 `.git` 祖先则用 cwd 本身）向下扫描 `.dsh/skills` 与 `.agents/skills`（含嵌套项目），上限为 4 层目录、64 个技能目录、4096 个已访问目录。建议把工作区注册在你实际工作的项目根；若注册目录本身在更大的 git 仓库里，扫描会从该仓库根开始（与宿主规则一致），同级项目可能一并出现。Windows 侧共享解不开的 Linux 符号链接会改由发行版解析（`wsl.exe … readlink -f`，每次查找最多 32 条、并发 4 条），解析后从真实路径继续扫描，因此 `ln -s` 链进来的项目、以及它下面的嵌套项目都能被发现，并按真实路径去重。技能正文始终实时读取。生成预设会把 `skill-filesystem` 行的 `watch` 固定为 `false`（对 `\\wsl.localhost\...` 开监视会失败），插件改为自己轮询，分两档：轻量档每 3 秒重查一次已发布的技能目录、并给每个技能文件记一次修改时间与大小，所以会话中途**新增、删除或改写**技能都会在下一个回合生效——改写这条正是时间戳的意义：模型看到的目录只在注册表修订号变化时重建，而光看目录列表分不出一个被改写的 `SKILL.md` 和没动过的文件。完整重新发现每 30 秒一次，因为只有走一遍才可能找到此前不存在的技能目录（比如新项目里的第一个 `.dsh/skills`）。两档都不重读技能正文。
- **shell 的生命周期**：`bash` 现在**有状态**——`cd`、export 的变量、激活的 venv、后台任务都跨调用保留。世界里挂了宿主的 PTY 注册表与它的可配置后端（`@deepseek-ai/dsh-terminal-bash`），并把后端指向本插件的中继脚本（`src/host/wsl-relay.ts` → `lib/wsl-relay.js`，由宿主自己的 node 运行）：中继把 PTY 交给 `wsl.exe … bash`，发行版取自会话的 UNC cwd（否则 `DSH_WSL_DISTRO`）、可选用户名取自 `DSH_WSL_USER`，并执行 `bash -lc 'cd … && exec bash -i'`——既加载登录环境，又保住会话目录（有些 profile 会把 `bash -l` 带回 `$HOME`）。该工具注册的名字是 `bash`，因此它取代非 WSL 预设里的 `dsh-tool-bash` 一行；世界同时隔离并提供自己的 no-op `sandbox` 能力（`src/host/wsl-sandbox.ts`）——PTY 后端在启动前会走 `ctx.sandbox`，而宿主的 Windows ACL 运行器读不了 `\\wsl.localhost\…` 工作区根的安全描述符。两个 shell 都在发行版内运行，不受 DSH 文件策略约束——WSL 自身就是它们的隔离边界。**宿主包装命令带来的两个后果写在工具描述里**（本插件覆盖了默认描述，因为宿主默认两条都没提）：整轮会话只有这一只 shell，所以某次调用里的 `cd` 决定下一次从哪里开始——请用绝对路径或在命令开头显式 `cd`；宿主把每条命令包成 `eval -- $'…'`，所以命令以 `&` 结尾会把**整条包装命令**后台化——调用会立刻返回 exit code 0 且没有输出，真正的输出晚到，甚至落进下一次调用的输出里。后台任务请写成单独一行的 `( 长任务 > log 2>&1 ) &`，或使用后台任务工具。
- **老宿主回退到一次性 shell**：持久 shell 是**宿主**的代码，而在 Windows 上它需要一个平台进程检查器，那个东西从 `0.1.0-rc.8` 才有——在 `0.1.0-rc.7` 里 `spawnTerminal` 会在启动任何进程之前抛 `subprocess-local: terminal inspection is unsupported on platform win32`，于是该版本里**每一次 `bash` 调用都直接失败**（不碰 PTY 的 grep/glob 仍正常）。因此插件在启动时**探测**底座而不是假设：它把一个不存在的程序交给 `spawnTerminal`，这只会走到检查器那一步、不会真的创建进程，报错信息就能说明是哪一半失败。答案是否时，生成的世界保留一次性的 `dsh-tool-bash` 行（走本插件自己的 `ctx.shell`，不经 PTY），模型得到的是一个能用的无状态 shell，而不是每次调用都报错。八个已声明版本里只有 `0.1.0-rc.7` 是这种状态，之后的版本都拿到持久 shell。
- `wsl.exe` 在发行版尚未启动时向 stderr 打印的 localhost 端口转发提示（乱码但无害）可忽略。

## 更新日志

英文完整历史见 [README.md](README.md)，本节为对应中文记录（0.4.3 及更早为摘要）。

### 0.6.0 — 2026-09-19

- **WSL 会话补上了 `grep` 与 `glob`**：宿主的搜索套件跑的是打包的 Windows ripgrep，而模型给的路径全是 Linux 路径，于是生成的世界干脆丢掉了 `tool-fs-search`，让模型自己在 shell 里搜——这正是面板已知问题里的最后一条。现在世界挂上发行版内的同类实现，并保留宿主套件的契约：同样的工具名、参数 schema、条数上限（250 条命中 / 100 个路径）、输出 schema、`Line N:` 分组、命中数表头、超限尾部提示、搜索卡片与超限结果落盘；渲染直接调用 `@deepseek-ai/dsh-tool-fs-search` 自己导出的格式化函数，只有该包未导出的两处投影（卡片元数据与 glob 分页）在本插件里复刻，并有单测与它逐字节对比。`grep` 在发行版内跑 GNU grep（`-rnIEH -Z`、POSIX ERE、像 ripgrep 默认那样跳过隐藏项与 `node_modules`、不读 `.gitignore`），`glob` 用 GNU `find` 列文件并在插件内按 gitignore 风格匹配、按 ripgrep 的"最旧优先"修改时间排序。模型给的每个值都作为独立 argv 传给固定脚本，任何输入都不会被 shell 解析。
- **技能目录现在能感知"改写"，而不只是"新增"**：模型的目录消息只在注册表修订号变化时重建，而旧的探测只比对目录列表——所以改写一个已有的 `SKILL.md`（比如描述）它看不见，模型会一直用旧文案直到下个会话。轻量档现在额外给每个技能文件记修改时间与大小，并且从 10 秒改成 3 秒一次；完整重新发现——唯一能发现"此前不存在的技能目录"的一遍——挪到自己的 30 秒节奏。于是检测既更快，也比被它取代的"10 秒一遍"更省。
- **`lib/` 现在确定性重建**：`tsdown` 的产物是提交进仓库的，而 `clean: false` 加两个配置共用一个输出目录，导致早先构建留下的分包块每次都活下来。本地构建工具现在先清空目录，并补声明了三个运行时同伴依赖（`@deepseek-ai/dsh-tool-fs-search`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`）——这同时是它们保持 external、不把 DSH 工具栈再打包一份进本插件的原因。
- **验证**：八个已声明版本（`0.1.0-rc.7` … `0.1.5-rc.2`）各跑十三项门禁，新增 `search-real`——用真实发行版上的固定夹具驱动真实工具（记录框定、include 与 `{}` 展开、上限与尾部提示、落盘、卡片、错误码、argv 安全性、显式点名的点文件、读不了的根、名字含换行的根、`/mnt` 路径、超时中断与输出溢出、glob 排序与剪枝）——只剩既有的两项基线失败（`typecheck` 与需要在线服务的 `host-api`）。单测新增 `tests/wsl-search.test.ts`（33 例）与两例刷新用例；`skills-real` 现在也证明"改写技能文件"能通过共享自己的修改时间让目录失效。五个版本的浏览器真实会话端到端确认。
- **按"最坏输入"复查新代码抓到的四个缺陷**：隐藏文件守卫连"显式点名的文件"一起排掉（`grep path=.env` 返回 0 条）、`find` 的退出码被丢弃（`glob path=/nope-missing` 看起来像空目录）、glob 头部按行结尾（根目录名里带换行时被截断）、Windows 路径没做翻译（`grep path='D:\proj'` 失败，而 `read` 能读）。另外把落盘 schema 收紧成了闭合对象——那会让每次"超限且有落盘后端"的调用在返回时校验失败；技能变更探测也加了在飞行中守卫，一次慢 pass 不会再叠出多层 `wsl.exe` 调用。
- **宿主 `bash` 包装命令的行为写进了工具描述**：持久工具把每条命令包成 `eval -- $'…'`，所以命令末尾的 `&` 会把整条包装命令后台化——调用立刻返回、exit code 0、没有输出；而这只 shell 是整轮会话一个进程，`cd` 会带到下一次调用。宿主默认描述两条都没提，DSH 自己的极简模式还建议 `sleep 10 &`；世界现在覆盖描述，写明这两点与安全写法。
- **`0.1.0-rc.7` 不再拿到一个坏掉的 shell**：那个版本的 `dsh-subprocess-local` 没有 Windows 进程检查器，宿主的 PTY 持久 shell 在 Windows 上根本起不来（宿主自己也有这个缺口：它那个版本的极简模式挂 `persistent-bash` 时没有 Windows 守卫）。世界改为在启动时探测底座，答案是否就保留一次性的 `bash` 行——一个能用的无状态 shell——而不是每次都报错。已在真实会话里验证。

### 0.5.0 — 2026-09-19

- **文件工具现在跟随 Linux 符号链接**：`\\wsl.localhost` 共享只列得出链接条目、描述不了它——对链接的 `lstat`、`stat`、`readFile` 全部失败，而 `resolve()` 会回一个词法身份——于是链接路径被当成不存在的文件，链接进来的项目**根本读写不了**。现在只要这份共享描述不了该路径，`resolve`/`lstat` 就向发行版问一次（`wsl.exe … readlink -f`，与技能扫描同一个实现）并从真实路径继续。链接不会被普通文件替换；向悬空链接写入会创建它的目标并保留链接。
- **访问模式重新约束 WSL 会话**：变体在预设的 isolate realm 里挂自己的 `fs` 提供者，宿主的 `fs-sandbox` 包装层不在调用路径上，所以 `workspace-write` 拦不住工作区外写入（修复前实测：Linux 路径与 `D:\...` 路径都能写）。现在 `writeText`/`editText` 完全按 `@deepseek-ai/dsh-fs-sandbox` 的方式围栏：`ctx.sandboxPolicy`（工具层按次传入的优先，否则服务自解析）、同一份 `writableRoots` 白名单加发行版 `/tmp`、同样的 `FS_SANDBOX_DENIED`，并提供工具读取的 `sandboxMode` 以便声明升级。围栏在链接解析之后执行，判定的是真实路径——链接指向工作区外就按工作区外拒绝。
- **技能目录实时刷新**：此前对 UNC 固定 `watch: false`，会话中途加入的技能只能等下个会话。现在 provider 为每个服务过的扫描根维护一个变更探测，每 10 秒重查已发布的目录形状（技能根 + 条目名与类型，**不重读技能文件**），有变化就调 `control.invalidate()`，目录中间件会在会话下一个回合重新收集。
- **`bash` 换成有状态的 WSL shell**——逐模式矩阵反复暴露的那个缺口（每条 `bash` 都是新进程）。DSH 的 PTY 注册表支持替换后端，而 `@deepseek-ai/dsh-terminal-bash` 是配置驱动的，于是世界把它挂进自己的 `persistent-shell` 组（注册表是 agent 级服务），用 `backendType: wsl` 指向本插件的中继脚本（`src/host/wsl-relay.ts` → `lib/wsl-relay.js`），由宿主自己的 node 运行。中继解析发行版（会话 UNC cwd → `DSH_WSL_DISTRO` → 宿主默认）与可选用户名（`DSH_WSL_USER`），然后把自己的 stdio——也就是那个 PTY——交给 `wsl.exe -d … --cd … -e bash -lc 'cd … && exec bash -i'`：登录环境、交互式、且保留会话目录。`@deepseek-ai/dsh-tool-bash-persistent` 注册的工具名就是 **`bash`**，所以它取代了一次性的 `dsh-tool-bash` 行（同时挂载会让整个预设挂载失败——DSH 自己的极简模式正是用"只给持久 shell"来避开这个冲突）。世界还隔离并提供自己的 no-op `sandbox` 能力：PTY 后端在启动前会调 `ctx.sandbox`，而宿主的 Windows 运行器读不了 `\\wsl.localhost\…` 工作区根的安全描述符（`GetNamedSecurityInfoW failed (Win32 1)`），所以 WSL 会话声明 `enforcement: 'partial'`，把策略留在真正有意义的地方——文件工具里。
- **验证**：八个已声明版本（`0.1.0-rc.7` … `0.1.5-rc.2`）跑十二项门禁——新增 `fs-real`（真实后端上的链接解析、经链接与链接链读取、悬空链接创建、链接保留、出工作区链接的围栏、发行版 `/tmp` 允许）与 `relay-real`（真实 WSL 上的有状态 shell、发行版与用户名解析、干净退出）——仅剩既有的两项基线失败（`typecheck` 与需要在线服务的 `host-api`）。单测：`tests/fs-policy.test.ts`（7 例围栏）+ 技能 provider 的刷新用例，叠加在原有套件之上。

### 0.4.5 — 2026-09-19

- **链进 WSL 工作区的项目现在能被发现了**：`\\wsl.localhost` 9P 共享会把 Linux 符号链接当作条目列出来，却解析不了它的目标，于是技能扫描（本来就会在能解析链接的底层上跟随目录链接）直接跳过所有链接进来的项目，连带跳过它下面的嵌套项目（即 [#10](https://github.com/6Mikao9/dsh-wsl-workspace/issues/10) 描述的那种布局）。现在只要共享报出一个它跟随不了的链接，插件就回头问发行版本身（`wsl.exe -d <发行版> -- readlink -f <Linux 路径>`），拿到真实路径后从那里继续走。这条回退是有意加了上限的：每次查找最多 32 条链接、最多 4 个调用并发、单次超时 10 秒，原有的深度 / 已访问目录 / 技能目录预算不变。由于继续扫描的位置是解析后的真实路径，同一项目既被直接访问又被链接访问时只会走一次，指回工作区根目录的链接环也会被已访问集合吸收，不会打转。
- **这条回退不覆盖什么**：`read/write/edit` 仍然走 `WslFileSystem` 的路径解析，它不跟随 Linux 链接，因此直接读写链接路径会报路径不存在——请用真实路径。帮助面板的「已知问题」现在如实写这一点，而不再是"可以用 readlink 补，但尚未实现"。
- **为什么一条链接一个 `wsl.exe`**（实测记录）：`wsl.exe` 会**丢掉**命令之后的参数（`sh -c 'echo $#' sh a b c` 返回 0），而且它的命令行解析会把含双引号的参数截断，所以批量的 `sh` 循环没法可靠地透过它工作。直接 `readlink -f a b c` 也不行：GNU `readlink` 遇到第一个解析不了的路径就停下（仍以非零退出），批次里后面的链接会被无声地饿死。把每个路径作为进程参数交给一次短调用，就完全绕开了引号问题——带空格、引号、反斜杠的路径都能解析——代价是每条链接一个进程（热态约 35 ms；本机上 6 条链接端到端 179 ms；没有链接的工作区则完全不会启动发行版进程）。
- **验证**：八个已声明版本（`0.1.0-rc.7` … `0.1.5-rc.2`）跑通与 0.4.4 相同的 8/10 项检查（仅剩既有的 `typecheck` 基线与一项需要在线服务的检查）。真实 9P 检查现在会构造"只能靠符号链接进入"的 fixture，断言链接进来的项目、它下面的嵌套项目以及 `get()` 取正文；同一次运行里把回退能力摘掉再走一遍，两者都找不到，即修复前的行为在原位复现。在真实 WSL fixture 上（`/home/mille/symprobe/ws`：链到工作区外的目录、链接链、指向文件的链接、悬空链接、指回根目录的环）技能目录从 2 个变成 5 个，`get()` 也都能通过解析后的定位读回正文。

### 0.4.4 — 2026-09-19

- **在 WSL 变体基础上改出来的自定义模式完全用不了**：本插件靠 id 前缀（`wsl-`）识别自己的产物，于是「把生成的 `wsl-standard` / `wsl-cordis` 复制改名再改」得到的用户预设会被当成普通源预设，被**再追加一个世界组**。DSH 拒绝含两个 `wsl-world` 行的组合，选中该模式时直接失败：`无法切换到「WSL · <名称>」：duplicate loader entry id: wsl-world`；在"先挂载组、后校验行 id"的版本上，同一处重复会晚一步表现为 `tool "str replace editor" is already registered in this scope`（即 [#24](https://github.com/6Mikao9/dsh-wsl-workspace/pull/24) 报告的现象）。现在生成器会**替换**它找到的世界组（按挂载的 `shell-wsl` / `fs-wsl` provider id 识别，改过组名也能认出），每个变体最终只挂一个世界，且指向本机安装的 provider。源里重复出现的顶层行 id 也只保留第一处——DSH 遇到重复 id 是**整个预设**不可用，而不是只丢那一行。
- **`tool-str-replace-editor` 行与旧的 `str-replace-editor` 行一样被替换**（[#24](https://github.com/6Mikao9/dsh-wsl-workspace/pull/24)）：较新的名单用这个 id，而它注册的工具名与注入世界组里那个编辑器行相同，所以源里的那行会被丢弃，变体注入的、走 WSL 文件系统的编辑器保留。
- **变体显示名不再多出一层引号**：变体的 `preset.yml` 原先逐字复制源里的 `name:` 标量，于是 `name: 'Data mode'` 到了模式选择器里变成 `WSL · ''Data mode''`；现在会先去掉一层 YAML 引号再写出。
- **未采纳 [#24](https://github.com/6Mikao9/dsh-wsl-workspace/pull/24) 的做法**：禁用 `tool-cordis` 行来规避 inspect provider 重复注册。`disabled` 的行根本不会 apply，结果是 WSL 创造模式**直接丢掉** `cordis_inspect_list` / `cordis_inspect_query`（已与 0.4.3 对照：0.4.3 里两个工具都在，且能返回 host 与 client 两侧的 provider）；PR 描述里"模型仍能在工具目录看到、只是不能用"与实际不符。其报告中的重复注册需要该行被 apply 两次，而这在"由复制预设引起"的情形下已由上面的行 id 去重解决。
- **帮助面板整理**：面板最前面是一句问候语与仓库链接，新增「本次更新」一节，已知问题只保留仍然成立的条目——历史上的「0.4.3 已修复」说明与按版本讲旧 API 的段落已删除。兼容性 chips 保持原样：它们是本构建声明的清单，不是历史。
- **逐模式矩阵（真模型）**：在 `0.1.0-rc.7`、`0.1.1-rc.2`、`0.1.3-alpha.2`、`0.1.5-rc.2` 上，四个 WSL 变体（标准 / PTC / 极简 / 创造）各自跑一遍：用文件工具写文件、用 bash 执行 `uname -r; pwd; whoami` 并把输出重定向落盘、再读回文件。每个模式都在 `/home/mille/<工作区>/notes/` 里留下了 `MODE-<模式>-OK` 与 WSL2 内核输出，零 loader 报错；随后单独一次 bash 调用又回到工作区目录，即文档所写的「按次 shell」（PTY 组仍然不注入）。`0.1.2-rc.1` 与 `0.1.5-rc.1` 只做了四模式切换与真实回合，没有文件/bash 断言。
- **验证**：八个已声明版本（`0.1.0-rc.7` … `0.1.5-rc.2`）跑通与 0.4.3 相同的 8/10 项检查（仅剩既有的 `typecheck` 基线与一项需要在线服务的检查）；17 个已安装运行时里全部 shipped 预设共 136 次变换，除本次修复外结果不变；68 个"复制变体"场景全部收敛为单一新世界组。另做浏览器 + 真模型验证：复制变体模式本身、创造模式（检查工具完整）以及 `0.1.0-rc.7` 的标准流程。

### 0.4.3 — 2026-09-11

- **persona 文本位置变更**（[#22](https://github.com/6Mikao9/dsh-wsl-workspace/issues/22)）：DSH 把 persona 面向模型的字段从 `text` 改为内联 `suffix` + 折叠 `prefix`，而变体生成器只识别 `text: >-`，于是 WSL 环境说明从未追加（会话仍在发行版内运行，但模型不知道自己的 cwd 是 Linux 路径）。现在按 `suffix` → `text` → `prefix` 依次补写（内联标量会先折成块标量，句子落在原 `text` 块的位置），带 `complete: true` 的 persona 依旧不动。
- **帮助面板**：对话框新增「?」按钮，就地展示本构建声明的 DSH 版本（直接从 `package.json` 经宿主路由读取，不会与清单脱节）、插件的用法与特性，以及无法修复的已知限制。
- **UNC 工作区终于能收到技能目录**：宿主技能提供者用 `fs.watch` 监视工作区，对 `\\wsl.localhost\...` 会抛 `EISDIR`，该次观测被判为不完整，而 `dsh-tool-skill` 在快照不完整时会丢弃**整条**目录消息，于是 WSL 会话的模型一个技能都看不到。现在生成预设时把 `skill-filesystem` 行的 `watch` 固定为 `false`（若该行已有 `config:` 就并入，源里自己声明了 `watch` 则不动），目录改为在会话启动时扫描一次。代价是不再实时刷新：会话运行中途加入的技能要等下一个会话（技能正文仍实时读取）。
- **`verify-lib` 加固**：其注释/字符串剥离器会把注释里的孤立单引号与后面的引号配对、吞掉剩余 bundle，使所有 `node:*` 导入看起来都被 tree-shake 掉；现在引号规则遇换行即终止，与 JavaScript 字符串一致。

### 0.4.2 — 2026-09-10

- **在 `0.1.2-rc.1` 工作区里「创建并打开」**：会话启动器改为在对话框写入时解析——本插件 apply 早于发布 `uiWorkspace` 的 UI 域注册服务，apply 时缓存的值整页都是 `undefined`，于是「创建并打开」只建了工作区、没开会话，而对话框仍报成功。两种 API 都不存在的版本现在会在写入前直接失败，不再留下孤立工作区。
- **技能正文完整性**：`findFrontmatterEnd` 返回的就是正文首字符下标，此前的偏移会把首字符吃掉；同时**带 UTF-8 BOM 的 `SKILL.md` 不再被丢弃**（BOM 会在围栏检查前剥离）。
- **绑定收敛于迟到输入**：agent preset 名单与已注册的 `/mnt/<drive>` 工作区集都是绑定的输入且都异步到达，现在各自到达后重跑一遍，而不是等一个可能永远不来的会话存储事件。
- **兼容性清单修正**：`0.1.3-alpha.1` 并未发布（`npm view` 为 404），替换为已发布的 `0.1.3-alpha.2`。
- **可复现发布**：新增 `.gitattributes`（`* text=auto eol=lf`、`lib/** -text`）。`core.autocrlf=true` 会在检出时把文本文件改写成 CRLF，而 `lib/` 是提交并原样发布的，导致同一提交在不同机器上产出不同的 npm 包。
- **闭环测试**：`tests/client-lifecycle.test.mjs` 用发布出去的 `lib/client.js` 跑通新旧两种服务形态（`connection.api.agentPresets` + `workspaces.startSession` 与 `remote.agentPresets` + `uiWorkspace`），并断言「创建并打开」的正常、迟到注册与无启动器三种情况。

### 0.4.1 — 2026-09-03

- **DSH `0.1.2-rc.1` 兼容**：运行时按特性检测自动选用新旧 API——`uiWorkspace.startSession()`（`0.1.2-rc.1+`）/ `workspaces.startSession()`（`0.1.1-rc.2` 及更早）、`summary.projectionValues?.agentPreset`（`0.1.2-rc.1+`）/ `summary.agentPreset`（`0.1.1-rc.2` 及更早）；兼容性清单加入 `0.1.2-rc.1`。
- **修复 `0.1.2-rc.1+` 上的 `without inject` 崩溃**：agent preset 名单改经 `ctx.get('remote.agentPresets')` 读取（拓扑无关的服务查找），不再走 `remote` 聚合上的 `agentPresets` 属性——Cordis 的 associate 代理会拒绝未在 `inject` 声明的点号属性。`inject` 仍只保留两代 DSH 共有的服务（`slots`、`locale`、`sessions`、`workspaces`）。

### 0.4.0 — 2026-08-29

- **查询缓存**：已完成的技能目录查询按扫描根缓存 10 秒，避免在慢速 9P 共享上反复重扫；`get()` 仍实时读正文，新技能在 TTL 窗口内出现。
- **符号链接项目**：0.4.0 时显式识别目录符号链接并安全剪枝（不崩、不循环），并实测出"光靠共享本身跟不了"——Windows 侧无法解析 Linux 符号链接（`readlink` → `EISDIR`，`stat`/`readdir` → `ENOENT`）；0.4.5 改为交给发行版解析，链进来的项目因此可被发现（见该版本说明）。另加"名称 + 正文"指纹去重，保证能解析链接的平台上别名技能不会被发布两次。
- **块标量 frontmatter**：`description:` / `whenToUse:` 写成 YAML 块标量（`|`、`>`）现在能解析，此前这类技能会被静默丢弃。
- **兼容性清单**：`dsh.compatibility.dshReleases` 逐版本声明兼容性，并附可复现的一次性 Profile 安装/启动/卸载证据；`engines` 声明 Node.js 下限。
- **门禁脚本**：`scripts/check-rank-parity.mjs` 在项目等级常量与宿主 `dsh-skill-filesystem` 漂移时让发布失败。

### 0.3.2 — 2026-08-29

- **WSL 会话注入嵌套项目的技能目录**（[#10](https://github.com/6Mikao9/dsh-wsl-workspace/issues/10)）：注册工作区之下的嵌套项目里的 `.dsh/skills` / `.agents/skills` 会带宿主的项目等级与来源一并发布，模型看到的目录与会话 cwd 就在项目里时一致；发现过程有深度与预算上限，会剪掉 `node_modules` 与点目录，且不改动非 WSL 会话。
- **扫描根对齐宿主**：从项目子目录发起查询先就近解析 `.git` 祖先，深层 cwd 也能看到所属项目的技能，且不会泄漏该祖先之上的技能。
- **加固**：技能根预算按次强制，`skills.registerProvider` 调用加了保护，宿主 `skills` 服务形状不同时不再拖垮插件加载。
- **清理**：移除历史预构建 `lib/` chunk 中残留的死 vendor 代码（含内联的 schemastery 副本），并补充嵌套技能目录的回归测试与 TESTING.md 章节。

## 许可与出处

MIT，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)，NOTICE 精确列明：

- **改编/继承源码**：DeepSeek Harness（MIT）的 `dsh-bash-local`（执行器机制）、`dsh-fs-local`（`WslFileSystem` 子类化）、shipped agent presets（变体生成读取/变换）；
- **设计参考（未复制源码）**：[dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal)（MIT，wsl argv/WSLENV 思路）、[dsh-side-panel](https://github.com/ccq1/dsh-side-panel)（BSD-3-Clause，Host 路由模式）、[vpshub](https://github.com/Sdongmaker/vpshub)（MIT，路线图参考）。

发布/再分发时请保留 LICENSE 与 NOTICE。

## 致谢

特别感谢 [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)（DSH Web 鲸鱼娘皮肤系列 · 深海女仆工坊 maid-atelier，CC BY-NC-SA 4.0）：鲸鱼娘皮肤插件为 DeepSeek Harness Web 界面带来了一整套可爱的皮肤，让 DSH 的日常使用更有温度。
