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
  'help.news.title': '本次更新（0.4.5）',
  'help.news.body': 'WSL 工作区里的 Linux 符号链接现在会被跟随：Windows 侧 9P 共享只能列出链接、解不开目标时，扫描会向发行版问一次真实路径（wsl.exe readlink，有次数上限，与目录缓存同步过期），并继续往下走。\n用 ln -s 链进工作区的项目、以及它下面的嵌套项目，现在都能出现在技能目录里。',
  'help.usage.title': '用法与特性',
  'help.usage.body': '点击侧边栏底部的 W 按钮 → 选发行版 → 输入或浏览 Linux 路径 → 检查 → 创建并打开。\n创建出的会话里，bash 与文件工具都落在该发行版内，模型看到的路径全是 Linux 路径；Windows 盘可从会话内通过 /mnt/<盘符> 访问。\n四种模式（标准 / PTC / 极简 / 创造）各有 WSL 变体，在模式选择器里直接选即可，名字形如 WSL · Standard mode（标准模式）。\n用户名可选，等价于 wsl.exe -u <用户名>，只改变 bash 的运行身份；文件工具走 Windows 侧共享，不受它影响。\n技能目录从会话 cwd 最近的 .git 祖先开始向下扫描 .dsh/skills 与 .agents/skills（含嵌套项目），上限 4 层目录 / 64 个技能目录 / 4096 个已访问目录，并按扫描根缓存 10 秒。\n链接会被跟随：9P 解不开的符号链接交给发行版 readlink 解析出真实路径（每次查找最多 32 条）后继续扫描，链接进来的项目与它下面的嵌套项目都能扫到。\n为了让 UNC 工作区也能拿到目录，插件生成预设时会把技能行的 watch 关掉，目录改由会话启动时扫描一次：会话中途新加入的技能要等下一个会话才出现，而技能内容（get）始终是实时读取的。\nbash 在发行版内运行，不受 DSH 文件策略约束；文件工具（read/write/edit）受策略约束，工作区内修改模式下只能写工作区内。',
  'help.known.title': '已知问题',
  'help.known.body': 'Windows 侧 9P 共享无法解析 Linux 符号链接。技能扫描已经绕过它：遇到链接会调一次 wsl.exe readlink 取出真实路径再继续走（每次查找最多 32 条、并发 4 条，深度与访问预算照旧），所以用 ln -s 链进工作区的项目也能被扫到。文件工具（read/write/edit）的路径解析还没跟随链接，直接读写链接路径会报不存在——请改用真实路径。\nbash 是「按次 shell」：每次调用都从会话 cwd 起一个新 shell，cd、export 的变量、venv、后台任务都不跨调用保留，请串成一条命令或用绝对路径。WSL 变体没有持久 shell——宿主的 persistent-shell 组注册的 bash 工具名与变体世界重名（同时挂载会让整个预设挂载失败），它的 PTY 后端在 Windows 宿主上也起不来。\nWSL 会话里访问模式约束不到文件工具：策略层（fs-sandbox）包的是宿主 fs 服务，而变体在预设 realm 内挂自己的 fs 提供者，包装层不在调用路径上；0.1.5-rc.2 实测 workspace-write 下写工作区外（Linux 路径与 D:\\ 路径）都成功、无拒绝。非 WSL 会话不受影响，把策略接进 WSL 世界是后续工作。\n会话运行中途新加入的技能不会即时出现在目录里（因为对 UNC 关闭了文件监视，见「用法与特性」）；重开一个会话即可看到。技能内容本身始终实时读取。',
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
  'help.news.title': "What's new in 0.4.5",
  'help.news.body': 'Linux symlinks inside a WSL workspace are followed now: when the Windows-side 9P share lists a link but cannot resolve its target, the scan asks the distribution for the real path (wsl.exe readlink, bounded and expiring with the directory cache) and keeps walking there.\nA project linked in with ln -s - and any nested project below it - now shows up in the skill catalog.',
  'help.usage.title': 'Usage and features',
  'help.usage.body': 'Click the W button at the sidebar foot, pick a distribution, type or browse to a Linux path, press Check, then Create & open.\nIn that session the bash tool and the file tools run inside the distribution, so every path the model sees is a Linux path; Windows drives stay reachable as /mnt/<drive>.\nEach mode (Standard / PTC / Minimal / Creator) has a WSL variant in the mode picker, named like WSL · Standard mode.\nThe optional username behaves like wsl.exe -u <user> for the bash tool only; the file tools go through the Windows-side share and are unaffected.\nThe skill catalog is discovered from the nearest .git ancestor of the session cwd downwards (.dsh/skills and .agents/skills, nested projects included), bounded to 4 levels / 64 skill directories / 4096 visited directories, and cached per scan root for 10 seconds.\nSymlinks are followed: a link the share cannot resolve is resolved through the distribution (wsl.exe readlink, at most 32 per lookup) and the scan continues at the real path, so a linked-in project and its own nested projects are found too.\nSo that a UNC workspace still receives a catalog, the generated preset turns that row\'s `watch` off and the catalog is scanned once at session start: a skill added mid-session appears in the next session, while skill bodies are always read live.\nbash runs inside the distribution and is not wrapped by the DSH file policy; read/write/edit are, and workspace-write only writes inside the workspace.',
  'help.known.title': 'Known issues',
  'help.known.body': 'The Windows-side 9P share cannot resolve Linux symlinks. The skill scan works around it now: a link is resolved with wsl.exe readlink (at most 32 per lookup) and the walk continues at the real path, so a project linked in with ln -s is found. The file tools still do not follow links - use the real path.\nbash is one command per call: each invocation is a fresh shell in the session cwd, so cd, exported variables and background jobs do not carry over - chain them into one command or use absolute paths. WSL variants have no persistent shell (the host group collides on the tool name; its PTY backend cannot start on win32).\nThe access mode does not constrain a WSL session\'s file tools: the policy wraps the host fs service while a variant mounts its own fs provider inside the preset realm - on 0.1.5-rc.2, workspace-write allowed writes outside the workspace (Linux and D: paths). Non-WSL sessions are unaffected; a wiring fix is a follow-up.\nA skill added while a session is running does not show up in that session\'s catalog (file watching is off for UNC workspaces, see Usage and features); start a new session to pick it up. Skill bodies are always read live.',
  'help.footer.npm': 'npm package',
  'help.footer.repo': 'GitHub repository',
}
