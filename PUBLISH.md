# 发布清单（建立 GitHub Repository 用）

> 插件源码位置：`<deepseek-harness-checkout>/plugins/dsh-wsl-workspace/`
> 发布时请**把该目录拷贝为独立仓库目录**再 `git init`（不要直接在 harness checkout 里建仓库，避免带入无关文件、也避开根 `.gitignore` 对 `lib/` 的忽略）。

## 仓库基础信息

| 项 | 值 |
|---|---|
| 仓库名 | `dsh-wsl-workspace`（建议与包名一致） |
| 描述 | WSL workspace support for DeepSeek Harness: add a WSL workspace from the web GUI and run the whole agent session (bash + file tools) inside the WSL distribution. No toolchain install inside WSL required. |
| License | MIT（`LICENSE` + `NOTICE` 必须保留） |
| Topics（可选） | `deepseek-harness`、`dsh`、`dsh-plugin`、`wsl` |

## 进仓库的内容

**必须（功能与安装所需）**：

| 路径 | 说明 |
|---|---|
| `lib/` | **预构建产物（关键）**：克隆即装，`dsh plugin add <git-url>` 不跑构建。改源码后需在 harness checkout 里用 tsdown 重建再提交 |
| `cordis.patch.yml` | bundle 挂载清单（`dsh.bundle.patch`） |
| `package.json` | 含 `dsh.bundle` / `dsh.client` 清单、exports、peerDependencies。**记得填 `repository` 字段**（当前占位缺失） |
| `src/` | 全部源码（host / shell / fs / client / shared） |
| `LICENSE` | MIT |
| `NOTICE` | 第三方来源与许可（改编/参考已精确区分） |
| `README.md` | 已含安装/使用/开发/兼容性/已知限制 |
| `README.en.md` | 英文版（同内容） |
| `.gitignore` | 只忽略 `node_modules/`（本机 junction），**不忽略 `lib/`** |

**可选**：`DESIGN.md`（设计文档，保留有助贡献者）、`tests/`（单测/冒烟，README 有运行说明）、`tsconfig.json` / `tsdown.config.ts`（开发者构建用；注意它们期望在 harness checkout 内运行）。

**不要提交**：`node_modules/`（本机 junction 已忽略）、任何 `~/.dsh/` 相关文件、会话记录 zip 等。

## 建立步骤

```powershell
# 1) 拷贝为独立目录
Copy-Item -Recurse plugins\dsh-wsl-workspace D:\github\dsh-wsl-workspace
cd D:\github\dsh-wsl-workspace
# 2) 编辑 package.json：填 repository（如 "repository": { "type": "git", "url": "git+https://github.com/<user>/dsh-wsl-workspace.git" }）
# 3) git init
git init -b main
git add .
git commit -m "feat: WSL workspace support for DeepSeek Harness (M1)"
git remote add origin https://github.com/<user>/dsh-wsl-workspace.git
git push -u origin main
```

## 发布后自测（重要）

```powershell
# 在一个干净环境（或另一台 Windows + WSL 机器）验证克隆即装：
dsh plugin --profile web add https://github.com/<user>/dsh-wsl-workspace
# 重启 dsh web → 侧栏底部 Settings 旁出现 WSL 图标 → 添加 WSL 工作区 → 新会话 bash/文件工具跑在 WSL
```

## 待办/注意事项

- [ ] `package.json` 填 `repository`
- [ ] 可选：英文版 README（海外用户）；中文为主已可用
- [ ] 可选：npm 发布（需移除 `private: true`；GitHub 发布无需动）
- [ ] 兼容性：针对 deepseek-harness `master`（0.1.0-rc 时代）验证；上游改 `sidebar.footer.action` / `agentPresets` / `shellEnv` / `webServer` 接缝需同步适配
- [ ] 环境要求：Windows 主机 + WSL2 发行版；`wsl.exe` 在 PATH
- [ ] 已知限制（已写入 README）：WSL 会话无 grep 工具（Windows 侧 rg 打不开 Linux 路径）；旧会话（已产生输出）无法换组合；`workspace-write + ask` 权限下 bash 调用可能触发审批
