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

  'help.compat.title': '兼容性',
  'help.compat.versionLabel': '插件版本',
  'help.compat.unknown': '未能读取版本与兼容声明（宿主端没有响应）',
  'help.compat.body': '上方是这份构建声明兼容的 DSH 版本，每一条都在隔离实例上实测过（独立 DSH_HOME、依赖固定到该版本、跑满十项门禁）。\n插件在运行时会识别 DSH 版本：0.1.2 线用 uiWorkspace + remote.agentPresets，更早的版本用 workspaces.startSession + connection.api；两边都没有时会明确报错，而不是留下一个空工作区。\n版本不在列表里通常仍然可用，但未经验证。',
  'help.usage.title': '用法与特性',
  'help.usage.body': '点击侧边栏底部的 W 按钮 → 选发行版 → 输入或浏览 Linux 路径 → 检查 → 创建并打开。\n创建出的会话里，bash 与文件工具都落在该发行版内，模型看到的路径全是 Linux 路径；Windows 盘可从会话内通过 /mnt/<盘符> 访问。\n四种模式（标准 / PTC / 极简 / 创造）各有 WSL 变体，在模式选择器里直接选即可，名字形如 WSL · Standard mode（标准模式）。\n用户名可选，等价于 wsl.exe -u <用户名>，只改变 bash 的运行身份；文件工具走 Windows 侧共享，不受它影响。\n技能目录从会话 cwd 最近的 .git 祖先开始向下扫描 .dsh/skills 与 .agents/skills（含嵌套项目），上限 4 层目录 / 64 个技能目录 / 4096 个已访问目录，并按扫描根缓存 10 秒。\n为了让 UNC 工作区也能拿到目录，插件生成预设时会把技能行的 watch 关掉，目录改由会话启动时扫描一次：会话中途新加入的技能要等下一个会话才出现，而技能内容（get）始终是实时读取的。\nbash 在发行版内运行，不受 DSH 文件策略约束；文件工具（read/write/edit）受策略约束，工作区内修改模式下只能写工作区内。',
  'help.known.title': '已知问题',
  'help.known.body': 'Windows 侧共享无法解析 Linux 符号链接：用 ln -s 链进工作区的项目发现不了（扫描会跳过、不报错），请把工作区注册在真实项目目录所在的层级。\n在 DSH 0.1.0-rc.7 / 0.1.1-rc.2 上，新建会话草稿态的预设选择器不会显示 WSL 变体（这两个版本没有草稿态 API）；进入会话后标签是正确的。\n会话运行中途新加入的技能不会即时出现在目录里（因为对 UNC 关闭了文件监视，见「用法与特性」）；重开一个会话即可看到。技能内容本身始终实时读取。\n0.4.3 已修复：UNC 工作区下模型收不到技能目录（宿主 fs.watch 在 \\\\wsl.localhost\\… 上失败导致整条目录消息被丢弃），现在生成预设时会关闭该监视，目录照常注入。\n前两条是上游或版本本身的限制，本插件无法绕过。',
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

  'help.compat.title': 'Compatibility',
  'help.compat.versionLabel': 'Plugin version',
  'help.compat.unknown': 'Version and compatibility declaration unavailable (the host side did not answer)',
  'help.compat.body': 'The chips above are the DSH releases this build declares, each verified on an isolated instance (own DSH_HOME, dependencies pinned to that release, full check suite).\nThe plugin detects the DSH generation at runtime: the 0.1.2 line uses uiWorkspace + remote.agentPresets, older releases use workspaces.startSession + connection.api, and a release exposing neither fails loudly instead of leaving an empty workspace.\nA release outside the list usually still works, but is unverified.',
  'help.usage.title': 'Usage and features',
  'help.usage.body': 'Click the W button at the sidebar foot, pick a distribution, type or browse to a Linux path, press Check, then Create & open.\nIn that session the bash tool and the file tools run inside the distribution, so every path the model sees is a Linux path; Windows drives stay reachable as /mnt/<drive>.\nEach mode (Standard / PTC / Minimal / Creator) has a WSL variant in the mode picker, named like WSL · Standard mode.\nThe optional username behaves like wsl.exe -u <user> for the bash tool only; the file tools go through the Windows-side share and are unaffected.\nThe skill catalog is discovered from the nearest .git ancestor of the session cwd downwards (.dsh/skills and .agents/skills, nested projects included), bounded to 4 levels / 64 skill directories / 4096 visited directories, and cached per scan root for 10 seconds.\nSo that a UNC workspace still receives a catalog, the generated preset turns that row\'s `watch` off and the catalog is scanned once at session start: a skill added mid-session appears in the next session, while skill bodies are always read live.\nbash runs inside the distribution and is not wrapped by the DSH file policy; read/write/edit are, and workspace-write only writes inside the workspace.',
  'help.known.title': 'Known issues',
  'help.known.body': 'The Windows-side share cannot resolve Linux symlinks, so a project linked in with ln -s is not discoverable (the scan skips it without failing); register the workspace at a level that holds the real project directories.\nOn DSH 0.1.0-rc.7 and 0.1.1-rc.2 the preset picker of a new draft session does not show the WSL variant (those releases have no draft API); the label inside the session is correct.\nA skill added while a session is running does not show up in that session\'s catalog (file watching is off for UNC workspaces, see Usage and features); start a new session to pick it up. Skill bodies are always read live.\nFixed in 0.4.3: on a UNC workspace the model did not receive the skill catalog at all (the host fs.watch call fails on \\\\wsl.localhost\\... and the whole catalog message was dropped). The generated preset now disables that watcher, and the catalog is injected as usual.\nThe first two are upstream or release limitations this plugin cannot work around.',
  'help.footer.npm': 'npm package',
  'help.footer.repo': 'GitHub repository',
}
