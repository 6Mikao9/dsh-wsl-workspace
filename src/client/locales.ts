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
  'help.news.title': '本次更新（0.7.4）',
  'help.news.body': '在 DSH Desktop 上对话框又能用了（issue #35、#36）。Desktop 宿主会在插件加载之前包装 child_process：装上普通的 exec / execFile 包装函数，再用 syncBuiltinESMExports() 把它们回写到内建模块。\n这份 execFile 上没有 util.promisify.custom，于是 promisify(execFile) 退回通用实现——它只用回调的第一个参数 resolve——结果每次调用拿到的 result.stdout 都是 undefined。发行版查询去读它就抛 Cannot read properties of undefined (reading \'includes\')，前端把异常吞掉、渲染出一个空的发行版列表：对话框能打开、下拉框里却一个发行版都没有，也创建不出工作区；而同一台机器上 wsl.exe -l -q 在终端里列得好好的，看上去像"插件找不到 WSL2"。\n三处调用（列发行版、默认发行版、符号链接解析）现在都改用 execFile 的回调形式，任何包装都改不了这个签名，输出再由 textOf 统一取文本。\nwsl.exe 的查找改成候选列表：先试 PATH 上的 wsl.exe，再试绝对路径 %SystemRoot%\\System32\\wsl.exe；都失败时报出试过的每一个候选以及各自的原因，而不是从解码器里冒出一个类型错误。\n新增 tests/exec-shape.mjs：复刻 Desktop 的包装形态（分别带与不带 --import 起一个探针进程），断言被包装的形态确实是坏的、新助手是对的，并把真实的三个函数在两种形态下各跑一遍；它注册为 Run-Checks 里的 exec-shape 检查，免得以后又被改回 promisify。',
  'help.usage.title': '用法与特性',
  'help.usage.body': '点击侧边栏底部的 W 按钮 → 选发行版 → 输入或浏览 Linux 路径 → 检查 → 创建并打开。\n创建出的会话里，bash 与文件工具都落在该发行版内，模型看到的路径全是 Linux 路径；Windows 盘可从会话内通过 /mnt/<盘符> 访问。\n四种模式（标准 / PTC / 极简 / 创造）各有 WSL 变体，在模式选择器里直接选即可，名字形如 WSL · Standard mode（标准模式）。\n用户名可选，等价于 wsl.exe -u <用户名>，只改变 bash 与 persistent-bash 的运行身份；文件工具走 Windows 侧共享，不受它影响。\n技能目录从会话 cwd 最近的 .git 祖先开始向下扫描 .dsh/skills 与 .agents/skills（含嵌套项目），上限 4 层目录 / 64 个技能目录 / 4096 个已访问目录，并按扫描根缓存 10 秒。9P 解不开的符号链接交给发行版 readlink 解析出真实路径（每次查找最多 32 条）后继续扫描，链接进来的项目与它下面的嵌套项目都能扫到。\n目录不再冻结：对 UNC 关闭文件监视之后，插件每 3 秒重查一次已发布的技能目录、并比对每个技能文件的修改时间与大小，所以新增、删除与改写都会在下一个回合生效；完整重新发现每 30 秒一次，用于找到此前不存在的技能目录（技能正文始终实时读取）。\n文件搜索由发行版内的 grep / glob 提供，源预设没有这两个工具的模式（极简）不会多出来：grep 用 GNU grep -E（\\d、\\w、(?i) 可用，环视与反向引用不支持），跳过隐藏项与 node_modules，不读 .gitignore；glob 用 GNU find 列文件、按 gitignore 风格匹配（* 不跨目录、** 跨、{a,b}、前导 ! 取反），按修改时间从旧到新排序。\n文件工具在链接处按真实路径工作，并按真实路径判策略：链接指向工作区外就等于工作区外。\nbash 由 PTY 承载的持久 shell 提供：登录环境、起始目录就是会话工作区，cd / export / venv / 后台任务跨调用保留（它取代了原先一次性 bash）。\n需要可跟踪的后台任务时用 bash_background：它立刻返回 job id，job_list / job_output（增量读取）/ job_kill 都作用于它；bash 本身没有 run_in_background 参数，传了会被忽略。job id 只在本次 DSH 进程内唯一，重启后会重新编号，引用前先用 job_list 确认。\nbash 与文件工具的 shell 都在发行版内运行、不受 DSH 文件策略约束；文件工具（read/write/edit）受策略约束，工作区内修改模式下只能写工作区内。',
  'help.known.title': '已知问题',
  'help.known.body': 'grep 用的是发行版自带的 GNU grep：方言是 POSIX ERE（环视与反向引用不支持），且不读 .gitignore，被 git 忽略的文件照样会被搜到；只有隐藏项、node_modules 与版本库目录会被跳过。发行版没有 GNU grep（如 Alpine 的 busybox）时会明确报错，而不是给出错位的结果。\nglob 的"按修改时间排序"依赖 GNU find -printf，busybox 会退化成路径排序；含 / 的 include 在插件进程里过滤，因此那种调用会先扫描全部文件再筛。\n技能目录刷新仍是轮询：已发布目录内的增删改约 3 秒生效，而一个新项目里第一次出现的技能目录要等下一次完整重新发现（最多 30 秒）。\n0.1.0-rc.7 的宿主没有 Windows 进程检查器，PTY 持久 shell 无法启动（宿主自己也这样），插件回退到一次性 bash：能正常用，但 cd / export 不跨调用保留。\n极简模式本身不挂 job_* 工具，所以那个模式里也没有 bash_background（与宿主的极简模式一致）。',
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
  'help.news.title': "What's new in 0.7.4",
  'help.news.body': 'The dialog works in DSH Desktop again (issues #35, #36). The Desktop host wraps child_process before the plugin loads: it installs plain exec / execFile wrappers and re-exports them with syncBuiltinESMExports().\nThat copy of execFile carries no util.promisify.custom, so promisify(execFile) fell back to the generic implementation, which resolves with the first callback argument only - the stdout string - and result.stdout was undefined on every call.\nThe distro lookup read it and threw "Cannot read properties of undefined (reading \'includes\')"; the frontend caught that and rendered an empty distro picker: the dialog opened, the list stayed empty and no workspace could be created, while wsl.exe -l -q listed the distribution normally in a terminal.\nAll three call sites (list distros, default distro, symlink resolution) now use the callback form of execFile, which no wrapper can reshape; textOf takes the text out of either stream shape.\nThe wsl.exe lookup is a candidate list: wsl.exe on PATH first, then %SystemRoot%\\System32\\wsl.exe, and a failure now names every candidate it tried with the error each produced instead of a type error from inside the decoder.\ntests/exec-shape.mjs reproduces the Desktop wrapper (a probe process with and without --import), asserts the wrapped shape is broken and the new helpers are right, and runs the three real functions through both shapes; it is registered as the exec-shape check in Run-Checks so nobody refactors it back.',
  'help.usage.title': 'Usage and features',
  'help.usage.body': 'Click the W button at the sidebar foot, pick a distribution, type or browse to a Linux path, press Check, then Create & open.\nIn that session the bash tool and the file tools run inside the distribution, so every path the model sees is a Linux path; Windows drives stay reachable as /mnt/<drive>.\nEach mode (Standard / PTC / Minimal / Creator) has a WSL variant in the mode picker, named like WSL · Standard mode.\nThe optional username behaves like wsl.exe -u <user> for bash and persistent-bash; the file tools go through the Windows-side share and are unaffected.\nThe skill catalog is discovered from the nearest .git ancestor of the session cwd downwards (.dsh/skills and .agents/skills, nested projects included), bounded to 4 levels / 64 skill directories / 4096 visited directories, and cached per scan root for 10 seconds.\nA link the share cannot follow is resolved through the distribution (wsl.exe readlink, at most 32 per lookup) and the scan continues at the real path, so a linked-in project and its own nested projects are found too.\nThe catalog is not frozen: published skills directories are re-checked every 3 seconds (skill file mtime + size), so an add, remove or edit appears on the next turn; a 30-second walk finds a skills directory that did not exist before.\nFile search comes from grep / glob inside the distribution, and a mode that mounts no search suite (Minimal) gains none. grep is GNU grep -E (no lookaround or backreferences), skips hidden entries and node_modules, and does not read .gitignore; glob matches gitignore-style patterns here, oldest first.\nThe file tools work at the resolved real path of a link, and the policy is judged there too: a link out of the workspace is an outside write.\n`bash` is a PTY-backed stateful shell: login environment, starting directory the session workspace, and cd / exports / background jobs survive between calls.\nFor a tracked background job use bash_background: it returns a job id immediately, and job_list / job_output (incremental) / job_kill act on it.\n`bash` itself has no run_in_background parameter and ignores one; job ids are unique within this DSH process, so confirm with job_list before acting on one.\nBoth it and the file tools\' shell run inside the distribution, outside the DSH file policy; read/write/edit are inside it, and workspace-write only writes inside the workspace.',
  'help.known.title': 'Known issues',
  'help.known.body': 'grep is the distribution\'s GNU grep: POSIX ERE (no lookaround or backreferences), and it does not read .gitignore, so git-ignored files are searched too; only hidden entries, node_modules and VCS directories are skipped.\nglob\'s modification-time order needs GNU find -printf (busybox falls back to path order), and an include containing "/" is filtered in this process, so that call scans every file first.\nThe catalog refresh is still a poll: an add, remove or edit inside a published skills directory lands within about 3 seconds, while a new project\'s first skills directory waits for the next full re-discovery (up to 30 seconds).\n0.1.0-rc.7 has no Windows process inspector, so its PTY persistent shell cannot start (the host has the same gap) and the plugin falls back to a one-shot bash: it works, but cd / exports do not survive.\nMinimal mode mounts no job_* tools, so it gets no bash_background either - the same as the host\'s own Minimal mode.',
  'help.footer.npm': 'npm package',
  'help.footer.repo': 'GitHub repository',
}
