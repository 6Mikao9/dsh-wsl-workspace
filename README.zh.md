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
- **文件工具（read/write/edit）**：经 Windows 侧的 WSL 9P 共享访问，受 DSH 文件策略约束。`workspace-write` 下读可到任意位置、写仅限会话工作区；改为 `danger-full-access` 后工作区外也可写入。用户名设置不影响文件工具。
- **技能目录（skill catalog）**：从会话 cwd 最近的 `.git` 祖先开始（没有 `.git` 祖先则用 cwd 本身）向下扫描 `.dsh/skills` 与 `.agents/skills`（含嵌套项目），上限为 4 层目录、64 个技能目录、4096 个已访问目录；结果按扫描根缓存 10 秒，技能正文始终实时读取。一个底层限制不是本插件能修的：Windows 侧的 `\\wsl.localhost` 共享**无法解析 Linux 符号链接**（用 `ln -s` 链进来的项目发现不了，扫描会跳过而不报错，请把工作区注册在真实项目目录所在的层级）。**0.4.3 已修复**：UNC 工作区原先**收不到技能目录**——宿主技能提供者用 `fs.watch` 监视该共享，对 `\\wsl.localhost\...` 会抛 `EISDIR`，该次观测被判为不完整，而 `dsh-tool-skill` 在快照不完整时会丢弃整条目录消息。现在生成预设时会把 `skill-filesystem` 行的 `watch` 固定为 `false`，目录在会话启动时扫描一次并照常注入。唯一代价是不再实时刷新：会话运行中途新加入的技能要等下一个会话才出现在目录里（技能正文仍由 `get` 实时读取）。
- `wsl.exe` 在发行版尚未启动时向 stderr 打印的 localhost 端口转发提示（乱码但无害）可忽略。

## 更新日志

英文完整历史见 [README.md](README.md)，本节为对应中文记录（0.4.3 及更早为摘要）。

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
- **符号链接项目**：显式识别目录符号链接并安全剪枝（不崩、不循环），但经排查属底层限制——Windows 侧无法解析 Linux 符号链接（实测 `readlink` → `EISDIR`，`stat`/`readdir` → `ENOENT`），因此用 `ln -s` 链进来的项目仍发现不了；另加"名称 + 正文"指纹去重，保证解析得到链接的平台上别名技能不会被发布两次。
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
