# dsh-wsl-workspace

[English](README.en.md)

在 DeepSeek Harness Web GUI 中「添加 WSL 工作区」，像 VS Code Remote-WSL 一样把**整个 agent 工作区**切换到本机 WSL 发行版里：bash 命令、文件读写（read/write/edit）全部落在 WSL 执行世界，**WSL 内零安装**（不需要在 WSL 里配置 DSH 工具链）。

## 工作原理

- **工作区身份 = UNC 路径**（`\\wsl.localhost\<distro>\<linux path>`）。Windows 的 Node 直接读写该路径（9P 共享），所以 `fs-wsl` 零安装落地；`processPath`/`displayPath` 对模型显示 Linux 路径。
- **按会话切换执行世界 = preset 变体族**。插件在启动时为 roster 里每个健康模式（标准、PTC、极简、创造、自定义）生成 `wsl-<模式>` 变体（`wsl-standard`、`wsl-code`、`wsl-minimal`、`wsl-cordis`…），写入 `<dshHome>/.agent-presets/`（官方 roster 自动扫描的 user root）。每个变体在 entry-local realm 里提供 `shell`（`WslShellExecutor`：`wsl.exe -d <distro> --cd <linux cwd> -e bash -lc` + WSLENV 透传）和 `fs`（`WslFileSystem`），并挂载 `tool-bash`/`tool-fs`——**执行世界与模式正交**：WSL 工作区里依然可以选标准/PTC/极简/创造，工具链跑在 WSL 里。**不存在独立的 WSL 模式**；旧版遗留的独立 `wsl` preset 目录会在启动时被清理。
- **自动绑定（模式映射）**：前端监视会话列表——任何**空白会话**的工作区是 WSL UNC 路径时，把它从当前模式自动映射到对应的 WSL 变体（选「标准」→ `wsl-standard`，选「PTC」→ `wsl-code`，……）。任何创建路径（本插件对话框、工作区行的 New Session、hero 选择器）都会收敛到 WSL 支持的组合；Host 只允许空白会话换组合。
- **入口**：侧栏底部 Settings 旁的圆形图标按钮（宽栏 28px / 轨道 36px，官方 `sidebar.footer.action` 槽）→ 对话框（发行版下拉 + Linux 目录浏览/输入 + 校验）→ 创建 UNC 工作区并开新会话。
- **联合访问**：WSL 会话内 Windows 文件系统经 `/mnt/<drive>`（如 `/mnt/c/Users/...`）对 bash 和文件工具同时可见可写——文件迁移就是一次跨路径 read/write 或 bash `cp`。

## 安装（web profile）

三种方式任选其一，然后重启 `dsh web`：

```powershell
# 1) 本地目录（开发/自用）
dsh plugin --profile web add D:\path\to\dsh-wsl-workspace

# 2) GitHub 仓库（克隆即装：仓库内已含预构建 lib/，无需本地构建）
dsh plugin --profile web add https://github.com/<user>/dsh-wsl-workspace

# 3) npm 包（若已发布）
dsh plugin --profile web add dsh-wsl-workspace
```

安装后重启 `dsh web`，侧栏底部 Settings 旁出现 WSL 图标。

> **注意**：从 Git/npm 安装会以「快照」方式落地到 profile；改动插件源码后需要重新 `add`。开发期想「改源码即时生效」用 junction 直连：`node_modules` junction 指向 profile 的 node_modules、`cordis.patch.yml` 挂载行——详见 [dsh-bash-terminal 的本地安装章节](https://github.com/MAXeaglet/dsh-bash-terminal)（同款模式）。

## 开发与构建

本插件**设计上运行于 DeepSeek Harness 内部**：运行时所有 `@deepseek-ai/*` 依赖由宿主解析（peerDependencies），构建产物 `lib/` 已随仓库提交（`dsh plugin add` 无需构建）。

- **构建**（改源码后）：需要 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) checkout 作为仓库环境（tsconfig `paths` 与 tsdown externals 指向其包），然后 `node <checkout>/node_modules/tsdown/dist/run.mjs --config tsdown.config.ts`。
- **类型检查**：`node <checkout>/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（同样依赖 checkout 的 `lib/types`）。
- **测试**（需要本机装有 WSL）：
  ```powershell
  node --import tsx/esm --test tests/paths.test.ts tests/variants.test.ts
  node --import tsx/esm tests/smoke.ts          # 真实 WSL 集成冒烟
  node tests/host-materialize.mjs               # preset 变体生成断言
  ```
  开发期 `tests/` 解析 `@deepseek-ai/*` 需要 `node_modules` junction → 宿主 profile 的依赖镜像（`$env:USERPROFILE\.dsh\profiles\node_modules`）。

## 兼容性（依赖的官方扩展点）

插件只使用 DeepSeek Harness 官方扩展点，不改动任何官方源码：

| 扩展点 | 用途 |
|---|---|
| `sidebar.footer.action` 槽 | 侧栏底部 WSL 按钮 |
| `agentPresets` 服务（`list`/`read`） | 枚举源模式、读取组合以生成变体 |
| `agentPreset.select` / 会话 `agentPreset` 字段 | 空白会话的模式映射 |
| `ctx.shellEnv`（`DSH_*` 事实） | 向执行器注入会话发行版（`DSH_WSL_DISTRO`） |
| `ctx.webServer.register` | 对话框数据路由 |
| preset roster + `isolate` realm | `wsl-<模式>` 变体组合 |
| WSL 9P UNC 文件系统（Node fs） | `fs-wsl` 零安装落地 |

已在 deepseek-harness `master`（当前 0.1.0-rc 时代）验证；上游若改动上述接缝需同步适配。

## 使用

1. 侧栏底部 Settings 旁点 WSL 图标。
2. 选发行版、浏览/输入 Linux 目录（如 `/home/me/proj`），点「创建并打开」。
3. 新会话随即运行在 WSL：`bash` 工具在 WSL 里执行，`read/write/edit` 读写 WSL 文件，路径均为 Linux 形式；Windows 文件经 `/mnt/<drive>` 访问。

在 WSL 工作区里，模式选择器依然可选标准/PTC/极简/创造——任何模式都会自动落到它的 WSL 变体（选择器里也直接可见「WSL · 标准模式」等条目，可手动选）。Windows 本地工作区则不受影响，照常用原模式。为保持官方包零改动，模式选择器不做按工作区的过滤（本机也会显示 WSL 变体条目）；在本机工作区选了 WSL 变体时，会话的 bash 会通过 `/mnt/<drive>` 指向 Windows 文件系统。

## 配置（变体文件，不经过设置 UI）

`<dshHome>/.agent-presets/wsl-*/agent.cordis.yml` 由插件在每次启动时重写（managed file）。可调项在 `shell-wsl` / `fs-wsl` 行的 `config`：

| 键 | 默认 | 说明 |
|---|---|---|
| `distro` | 无（从工作区 UNC 自动取） | 兜底发行版，仅当 workdir 不带发行版时使用 |
| `wslPath` | `wsl.exe` | wsl 可执行文件 |
| `loginShell` | `true` | `-lc` 登录 shell（加载 nvm/cargo 等 profile PATH） |
| `timeoutMs` / `maxTimeoutMs` / `maxOutputBytes` / `maxSpillBytes` / `graceMs` | 同 `dsh-bash-local` | 执行预算 |
| `fs-wsl.cwd` / `diffBasisMaxBytes` | 无 / 10MiB | fs 底座与 diff 上限 |

插件行 `wsl-workspace` 的 `config`：

| 键 | 默认 | 说明 |
|---|---|---|
| `route` | `/wsl-workspace/api` | 对话框数据路由 |

## 已知限制（v1）

- **已产生输出的旧会话无法换组合**：Host 只允许**空白**会话切换 preset。插件安装前创建、或处于标准模式的旧会话，如果工作区是 `\\wsl.localhost\...` UNC 路径，PowerShell 的 provider 无法枚举该共享（`GetNamedSecurityInfoW failed (Win32 1)`——9P 不支持该 Windows 安全 API，**不是沙箱拦截**）。同会话的 read/write/edit 文件工具（Node fs）不受影响，`cmd /c dir`、`wsl.exe -d <distro> ls` 可用；要根治在该工作区**新建**会话即可。插件安装后新建的会话会自动映射到 WSL 变体，不会再出现这个组合。绑定到旧版独立 `wsl` preset 的会话在重启后同样无法恢复（该 preset 已被并入变体族），需要重新创建。
- **沙箱**：Windows ACL 沙箱无法包裹 `wsl.exe`（子进程在 Linux 内核侧）。WSL 独立 VM 即隔离边界（结果上报 `wsl-isolation` 语义）；`assumeWslIsolation` 的 fail-closed 开关留待 v2。在 `workspace-write + ask` 权限组合下，WSL 会话的 bash 调用可能触发审批提示——v1 面向 `danger-full-access`（开发人员单机）场景。
- **进程树终止**：杀掉 `wsl.exe` 中继不一定终止发行版内的整个进程树，后台进程在超时/中断后可能在发行版内短暂残留（与 `dsh-bash-terminal` 相同的 WSL 语义）。
- **WSL 会话没有 `grep` 工具**：`tool-fs-search` 打包的 ripgrep 在 Windows 侧运行，无法打开 Linux 路径（会报「拒绝访问 os error 5」），因此所有 WSL 变体都移除了它——搜索用 bash 的 `grep`/`rg`（在 WSL 内运行，正常工作）。
- **9P 语义**：stat 版本令牌来自 9P 元数据，极快的并发写可能误报 `FS_STALE_VERSION`；大目录列举性能一般（M5 计划用 WSL 侧 thin helper 提速，UNC 模式保留为回退）。
- **无交互终端（PTY）**：M3 里程碑（ConPTY 包 wsl.exe 的 `spawnTerminal`）。

## 路线图

M1 核心闭环（本版）→ M2 侧栏文件树面板（改写 dsh-side-panel，走 `ctx.fs` 接缝）→ M3 交互终端 → M4 SSH 远程工作区（vpshub 式台账）→ M5 性能增强。详见 `DESIGN.md`。

## 许可与出处

MIT，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。NOTICE 精确列明：

- **改编/继承源码**：DeepSeek Harness（MIT）的 `dsh-bash-local`（执行器机制）、`dsh-fs-local`（`WslFileSystem` 子类化）、shipped presets（变体生成读取/变换）；
- **设计参考（未复制源码）**：[dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal)（MIT，wsl argv/WSLENV 思路）、[dsh-side-panel](https://github.com/ccq1/dsh-side-panel)（BSD-3-Clause，Host 路由模式）、[vpshub](https://github.com/Sdongmaker/vpshub)（MIT，路线图参考）。

发布/再分发时请保留 LICENSE 与 NOTICE。
