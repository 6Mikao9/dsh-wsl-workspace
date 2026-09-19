/**
 * Bilingual dictionaries for the `wslWorkspace` locale namespace. Product copy
 * is Chinese; English is the parallel export for the standalone bundle.
 */

/**
 * The `wslWorkspace` translations (Chinese, the primary product copy).
 */
export const zh: Record<string, string> = {
  'action.add': 'WSL 工作区',
  'action.title': '添加 WSL 工作区…',

  'dialog.title': '添加 WSL 工作区',
  'dialog.distro': '发行版',
  'dialog.path': '路径',
  'dialog.pathPlaceholder': '/home/',
  'dialog.username': '用户名',
  'dialog.usernamePlaceholder': '留空则使用发行版默认用户',
  'dialog.loading': '正在加载…',
  'dialog.browseEmpty': '此目录没有子文件夹',
  'dialog.upLevel': '..（返回上级）',
  'dialog.browse': '浏览',
  'dialog.check': '检查',
  'dialog.confirm': '创建并打开',
  'dialog.cancel': '取消',
  'dialog.retry': '重试',

  'error.loadDistros': '无法获取 WSL 发行版列表，请确认已安装 WSL 且插件宿主端可用',
  'error.rateLimited': '操作过于频繁，请稍后重试',
  'error.loadDir': '无法浏览该目录',
  'error.presetMissing': '未找到健康的 wsl preset，请确认插件宿主端已安装并配置该 preset',
  'error.invalidPath': '请输入以 / 开头的 Linux 绝对路径',
  'error.invalidUsername': '用户名无效：需以字母或下划线开头，仅含字母、数字、_、.、-',
  'error.pathNotFound': '该路径不存在或是文件，请选择一个文件夹',
  'error.createFailed': '创建工作区失败',
  'help.button': '插件说明',
  'help.greeting': '当你看到这句话的时候，说明你的插件已经Cia进来llo～(∠・ω< )⌒★，star一下吗？',
  'help.greeting.repo': 'github.com/6Mikao9/dsh-wsl-workspace',

  'help.compat.title': '兼容性',
  'help.compat.versionLabel': '插件版本',
  'help.compat.unknown': '未能读取版本与兼容声明（宿主端没有响应）',
  'help.compat.body': '上方是这份构建声明兼容的 DSH 版本，每一条都在隔离实例上实测过（独立 DSH_HOME、依赖固定到该版本、跑满十项门禁）。\n插件在运行时自动识别 DSH 版本并选用对应的 API；两边都不支持时会明确报错，而不是留下一个空工作区。\n版本不在列表里通常仍然可用，但未经验证。',
  'help.news.title': '本次更新（0.5.0）',
  'help.news.body': 'WSL 世界对齐宿主：文件工具现在跟随 Linux 符号链接（并在解析出真实路径之后再判策略），会话的访问模式（工作区内修改 / 只读 / 完全访问）真正约束到 WSL 会话的文件工具。\n技能目录不再冻结：插件每 10 秒探测一次目录变化，中途加入的技能会在下一个回合出现在目录里（技能正文本来就实时）。\n新增 persistent-bash：PTY 承载的持久 WSL shell，登录环境、起始目录就是会话工作区，cd / export / venv / 后台任务都能跨调用保留；原来一次性的 bash 仍在。',
  'help.usage.title': '用法与特性',
  'help.usage.body': '点击侧边栏底部的 W 按钮 → 选发行版 → 输入或浏览 Linux 路径 → 检查 → 创建并打开。\n创建出的会话里，bash 与文件工具都落在该发行版内，模型看到的路径全是 Linux 路径；Windows 盘可从会话内通过 /mnt/<盘符> 访问。\n四种模式（标准 / PTC / 极简 / 创造）各有 WSL 变体，在模式选择器里直接选即可，名字形如 WSL · Standard mode（标准模式）。\n用户名可选，等价于 wsl.exe -u <用户名>，只改变 bash 与 persistent-bash 的运行身份；文件工具走 Windows 侧共享，不受它影响。\n技能目录从会话 cwd 最近的 .git 祖先开始向下扫描 .dsh/skills 与 .agents/skills（含嵌套项目），上限 4 层目录 / 64 个技能目录 / 4096 个已访问目录，并按扫描根缓存 10 秒。9P 解不开的符号链接交给发行版 readlink 解析出真实路径（每次查找最多 32 条）后继续扫描，链接进来的项目与它下面的嵌套项目都能扫到。\n目录不再冻结：对 UNC 关闭文件监视之后，插件每 10 秒重查一次目录形状，发现变化就让宿主重建目录，所以会话中途加入的技能会在下一个回合出现。\n文件工具在链接处按真实路径工作，并按真实路径判策略：链接指向工作区外就等于工作区外。\nbash 每次调用都是新 shell；需要跨调用保留状态时用 persistent-bash（PTY、登录环境、起始目录就是会话工作区）。bash 与 persistent-bash 都在发行版内运行、不受 DSH 文件策略约束；文件工具（read/write/edit）受策略约束，工作区内修改模式下只能写工作区内。',
  'help.known.title': '已知问题',
  'help.known.body': 'WSL 会话里没有文件搜索（grep）工具：打包的 ripgrep 跑在 Windows 侧，打不开 Linux 路径；请在 bash 或 persistent-bash 里用 grep / rg。\n技能目录刷新是 10 秒一次的轮询：刚加进去的技能最多晚约 10 秒出现，且只在下一个回合生效；改动已有技能文件里的描述不会触发重建（目录形状没变），要等缓存的 10 秒过期或下一个会话。技能正文始终实时读取。',
  'help.footer.npm': 'npm 包',
  'help.footer.repo': 'GitHub 仓库',
}

/**
 * The `wslWorkspace` translations (English).
 */
export const en: Record<string, string> = {
  'action.add': 'WSL Workspace',
  'action.title': 'Add WSL workspace…',

  'dialog.title': 'Add WSL workspace',
  'dialog.distro': 'Distro',
  'dialog.path': 'Path',
  'dialog.pathPlaceholder': '/home/',
  'dialog.username': 'Username',
  'dialog.usernamePlaceholder': 'Leave empty to use the distro default user',
  'dialog.loading': 'Loading…',
  'dialog.browseEmpty': 'No subdirectories here',
  'dialog.upLevel': '.. (up)',
  'dialog.browse': 'Browse',
  'dialog.check': 'Check',
  'dialog.confirm': 'Create & open',
  'dialog.cancel': 'Cancel',
  'dialog.retry': 'Retry',

  'error.loadDistros': 'Could not list WSL distros; confirm WSL is installed and the plugin host side is reachable',
  'error.rateLimited': 'Too many attempts; retry in a moment',
  'error.loadDir': 'Could not browse this directory',
  'error.presetMissing': 'No healthy "wsl" preset found; confirm the plugin host side installed and configured it',
  'error.invalidPath': 'Enter an absolute Linux path starting with /',
  'error.invalidUsername': 'Invalid username: start with a letter or underscore; only letters, digits, _ . -',
  'error.pathNotFound': 'The path does not exist or is a file; choose a folder',
  'error.createFailed': 'Failed to create the workspace',
  'help.button': 'About this plugin',
  'help.greeting': 'If you can read this, the plugin has already Cia~llo\'d its way in～(∠・ω< )⌒★ Care to star the repo?',
  'help.greeting.repo': 'github.com/6Mikao9/dsh-wsl-workspace',

  'help.compat.title': 'Compatibility',
  'help.compat.versionLabel': 'Plugin version',
  'help.compat.unknown': 'Version and compatibility declaration unavailable (the host side did not answer)',
  'help.compat.body': 'The chips above are the DSH releases this build declares, each verified on an isolated instance (own DSH_HOME, dependencies pinned to that release, full check suite).\nThe plugin detects the DSH generation at runtime and picks the matching API; a release exposing neither fails loudly instead of leaving an empty workspace.\nA release outside the list usually still works, but is unverified.',
  'help.news.title': "What's new in 0.5.0",
  'help.news.body': 'The WSL world now matches the host: the file tools follow Linux symlinks (and judge the policy at the resolved real path), and the session\'s access mode (workspace-write / read-only / full access) actually constrains a WSL session\'s file tools.\nThe skill catalog is no longer frozen: the plugin polls the directory shape every 10 seconds, so a skill added mid-session shows up on the next turn (bodies were always live).\nNew: `persistent-bash`, a PTY-backed stateful WSL shell - login environment, starting directory the session workspace - so cd, exports, venvs and background jobs survive between calls. The one-shot `bash` is still there.',
  'help.usage.title': 'Usage and features',
  'help.usage.body': 'Click the W button at the sidebar foot, pick a distribution, type or browse to a Linux path, press Check, then Create & open.\nIn that session the bash tool and the file tools run inside the distribution, so every path the model sees is a Linux path; Windows drives stay reachable as /mnt/<drive>.\nEach mode (Standard / PTC / Minimal / Creator) has a WSL variant in the mode picker, named like WSL · Standard mode.\nThe optional username behaves like wsl.exe -u <user> for bash and persistent-bash; the file tools go through the Windows-side share and are unaffected.\nThe skill catalog is discovered from the nearest .git ancestor of the session cwd downwards (.dsh/skills and .agents/skills, nested projects included), bounded to 4 levels / 64 skill directories / 4096 visited directories, and cached per scan root for 10 seconds.\nA link the share cannot follow is resolved through the distribution (wsl.exe readlink, at most 32 per lookup) and the scan continues at the real path, so a linked-in project and its own nested projects are found too.\nThe catalog is not frozen: with file watching off for UNC workspaces, the plugin re-checks the directory shape every 10 seconds and asks the host to rebuild, so a skill added mid-session appears on the next turn.\nThe file tools work at the resolved real path of a link, and the policy is judged there too: a link out of the workspace is an outside write.\nEvery `bash` call is a fresh shell; use `persistent-bash` when state must survive (PTY, login environment, starting directory the session workspace). Both run inside the distribution and are not wrapped by the DSH file policy; read/write/edit are, and workspace-write only writes inside the workspace.',
  'help.known.title': 'Known issues',
  'help.known.body': 'A WSL session has no file-search (grep) tool: the packaged ripgrep runs on the Windows host and cannot open Linux paths - use grep / rg from bash or persistent-bash.\nThe catalog refresh is a 10-second poll: a skill added mid-session appears within about 10 seconds, and only on the next turn.\nEditing the description of an existing skill does not trigger a rebuild (the directory shape did not change) - that waits for the 10-second cache to expire or the next session. Skill bodies are always read live.',
  'help.footer.npm': 'npm package',
  'help.footer.repo': 'GitHub repository',
}
