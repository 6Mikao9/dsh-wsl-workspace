# dsh-wsl-workspace

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

## 安装期的原生构建

安装本插件会拉取 peer 依赖 `@deepseek-ai/dsh-fs-local`，它又依赖 [`koffi`](https://www.npmjs.com/package/koffi)（Node.js 的动态 C FFI 库）。koffi 在 `npm install` 时会运行安装脚本（`node ./cnoke.cjs -P . -D src/koffi --prebuild --release`）：

- **预编译优先**：先尝试从 koffi 的 `optionalDependencies`（`@koromix/koffi-<平台>`）加载平台预编译 addon，覆盖 `win32-x64/arm64/ia32`、`linux-x64/arm64/ia32/riscv64/loong64`、`darwin-x64/arm64`、`freebsd-*`、`openbsd-*`。预编译可用时**不会编译**。
- **回退源码编译**：仅在预编译不可用/无法加载时才从源码重建，此时需要 CMake 与 C/C++ 编译器（Windows 下默认 Clang，MSYSTEM 环境用 MinGW）。这是 koffi 自身的标准行为；本插件本身不构建、也不携带任何原生代码。

这是预期行为，并非恶意（koffi 为 MIT 许可）。若以 `--ignore-scripts` 安装，koffi 的 addon 选择/构建会被跳过，在没有缓存预编译二进制的平台上 `@deepseek-ai/dsh-fs-local` 可能加载失败。WSL 会话本身无需工具链：bash 工具在 WSL 发行版内执行，文件工具经 Windows 侧 WSL 共享访问。

## 使用
点侧栏底部 Settings 旁的 W 按钮，打开「添加 WSL 工作区」对话框。先从下拉框选择一个发行版，再浏览目录树或直接输入 Linux 绝对路径（如 `/home/me/proj`），可以点「检查」确认路径存在。对话框文案跟随 DSH 界面语言。用户名是可选项：留空则以该发行版的默认用户运行，填写该发行版里的某个 Linux 用户名则以该用户运行（等价于 `wsl.exe -u <用户名>`）。用户名只影响 bash 命令的运行身份，文件工具通过 Windows 侧的 WSL 共享访问、不受其影响；每个工作区填写的用户名保存在 `<dshHome>/wsl-workspaces.json`，删除对应条目（或重开对话框重建工作区）即可恢复默认用户。

点「创建并打开」后，新会话随即运行在 WSL：`bash` 工具在所选发行版内执行命令，`read`/`write`/`edit` 读写 WSL 文件，模型看到的所有路径都是 Linux 形式。模式选择器照常可用——标准、PTC、极简、创造都会自动落到对应的 WSL 变体（选择器里的 WSL 变体条目为中英双语，如 `WSL · Standard mode（标准模式）`）；会话内仍可通过 `/mnt/<drive>`（如 `/mnt/c/Users/...`）访问 Windows 文件。
![alt text](image-2.png)
## 行为与权限说明

- **bash 工具**：以配置的用户名在 WSL 发行版内运行（留空 = 发行版默认用户，通常为 root），可对发行版内任意路径读写。Windows 的 ACL 沙箱无法包裹 `wsl.exe`（子进程运行在 Linux 内核侧），WSL 自身即隔离边界，DSH 文件策略不作用于 bash。
- **文件工具（read/write/edit）**：经 Windows 侧的 WSL 9P 共享访问，受 DSH 文件策略约束。`workspace-write` 下读可到任意位置、写仅限会话工作区；改为 `danger-full-access` 后工作区外也可写入。用户名设置不影响文件工具。
- `wsl.exe` 在发行版尚未启动时向 stderr 打印的 localhost 端口转发提示（乱码但无害）可忽略。
- **模式变体**：DSH 自带的每一个模式（标准、PTC、极简、创造，以及实验性的 Anchored Standard 等），本插件都会额外生成一个对应的 `wsl-<模式>` 变体。原始模式照常可用、不受影响；WSL 变体只是让同一模式运行在 WSL 执行环境里。

## 更新日志

### 0.2.4

- **修复 #5 —— WSL 极简模式不再破坏首轮「we need/lets」思维链。** 此前极简类预设（只暴露 `persistent-bash` 与 `str-replace-editor`）的 WSL 变体还会额外注入一次性 `bash` 工具以及 `read`/`write`/`edit`/`read_image` 文件工具；重复的 `bash` 工具名与多出的 schema 会放大首轮请求的工具清单、干扰思维链。现在极简类变体只保留 `persistent-bash`、`str-replace-editor` 与 `fs-wsl` 提供者；标准类预设仍会获得完整的 shell + 文件工具执行环境。

## 许可与出处

MIT，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)，NOTICE 精确列明：

- **改编/继承源码**：DeepSeek Harness（MIT）的 `dsh-bash-local`（执行器机制）、`dsh-fs-local`（`WslFileSystem` 子类化）、shipped agent presets（变体生成读取/变换）；
- **设计参考（未复制源码）**：[dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal)（MIT，wsl argv/WSLENV 思路）、[dsh-side-panel](https://github.com/ccq1/dsh-side-panel)（BSD-3-Clause，Host 路由模式）、[vpshub](https://github.com/Sdongmaker/vpshub)（MIT，路线图参考）。

发布/再分发时请保留 LICENSE 与 NOTICE。

## 致谢

特别感谢 [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)（DSH Web 鲸鱼娘皮肤系列 · 深海女仆工坊 maid-atelier，CC BY-NC-SA 4.0）：鲸鱼娘皮肤插件为 DeepSeek Harness Web 界面带来了一整套可爱的皮肤，让 DSH 的日常使用更有温度。
