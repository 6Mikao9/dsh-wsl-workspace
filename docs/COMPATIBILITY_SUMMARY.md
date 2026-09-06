# DSH 版本兼容性适配总结（最终结论）

> 本文档为 dsh-wsl-workspace v0.4.1 对 DSH 多版本兼容适配的**最终落地结论**。
> 取代根目录早期草案 `ADAPTATION_PLAN.md`（已废弃删除）与 `ADAPTATION_PLAN_V2.md`（内容并入本文）。
> Host 面可复现验证流程见 [compatibility-evidence.md](./compatibility-evidence.md)。

## 1. 适配目标（最终支持范围）

| DSH 版本 | 兼容方式 | 状态 |
|---|---|---|
| v0.1.0-rc.7 / rc.8 | 旧 API（`connection.api`） | `package.json` 声明 compatible |
| v0.1.1-rc.1 / rc.2 | 旧 API（`connection.api`） | `package.json` 声明 compatible |
| v0.1.2-rc.1 | 新 API（`remote.agentPresets` 命名空间） | `package.json` 声明 compatible |
| v0.1.3-alpha.x | 与 v0.1.2-rc.1 插件 API 面一致，无需额外适配 | `package.json` 声明 compatible |

单份浏览器端代码同时服务两代，**运行时按服务存在性自动分流**，无配置开关。

## 2. DSH 关键架构变更（v0.1.1-rc.2 → v0.1.2-rc.1）

### 2.1 客户端服务重组

- `sessions` / `workspaces`：`packages/client/runtime/` → `packages/api/session-controller/`、`packages/api/workspace-controller/`（**服务名不变**：`sessions`、`workspaces`，可安全进 `inject`）。
- 新增 `uiWorkspace` 服务（`packages/client/ui-workspace/src/client/navigation.ts`，`super(ctx, 'uiWorkspace')`），承载 `startSession()`，取代旧版 `workspaces.startSession()`。
- 远程调用方式重构：旧版 `connection.api.*` → 新版 `remote.<namespace>` 命名空间服务（由 `packages/api/gateway/src/client/index.ts` 按 `remote.${namespace}` 独立 fiber 注册）。

### 2.2 逐项 API 变更

| 能力 | v0.1.0-rc.7 ~ v0.1.1-rc.2 | v0.1.2-rc.1+ |
|---|---|---|
| preset 列表/选择 | `connection.api.agentPresets.list({})/select({sessionId, agentPreset})`，返回 `{result:{ok, value, error?}}` | `ctx.get('remote.agentPresets')` 命名空间 `.list()/.select(sessionId, presetId)`，返回 `RemoteResult` `{ok, value|error}` |
| 启动会话 | `workspaces.startSession(id)` | `uiWorkspace.startSession(id)` |
| 会话的 agentPreset | `summary.agentPreset` 直接字段 | `summary.projectionValues?.agentPreset`（`string\|null`，host 投影自动同步） |
| 记录 preset 变更 | `sessions.noteAgentPreset(id, preset)` | 已移除（`agent-preset/selected` 投影自动同步） |

### 2.3 版本特有服务清单（决定 inject 边界）

| 服务 | 旧版 | 新版 |
|---|---|---|
| `slots` / `locale` / `sessions` / `workspaces` | ✅ | ✅（**可进 inject**） |
| `connection`（`api` 子属性） | ✅ | ❌（新版 `ConnectionHandle` 无 `api`） |
| `remote` / `remote.agentPresets` | ❌ | ✅ |
| `uiWorkspace` | ❌ | ✅ |

## 3. 关键陷阱与解法（本次适配的核心教训）

### 3.1 Cordis `inject` 是静态阻塞声明

`inject` 里声明了当前 DSH 不存在的服务，插件会永久等待、`apply()` 永不执行（官方 postmortem 0001 有同类教训）。因此**版本特有服务绝不能进 `inject`**，只能运行时动态探测。

### 3.2 associate 代理陷阱 → `cannot get property "remote.agentPresets" without inject`

新版 `remote` 是聚合服务（associate）：对 `remote.agentPresets` 的属性访问会被 Cordis 可追踪代理（`vendor/cordis/src/utils.ts`）重定向为 `ctx['remote.agentPresets']` 点分属性解析，而点分属性走 **fiber 祖先遍历**，未在 `inject` 声明即抛上述错误。官方 `ui-agent-preset` 等插件因此把 `'remote.agentPresets'` 写进 `inject`。

**本插件解法**：用 `ctx.get('remote.agentPresets')`——`get` 是**全局 isolate-keyed store 直查**（`vendor/cordis/src/reflect.ts`），不走 fiber 遍历、无 inject 要求、服务不存在时返回 `undefined`。既满足新版调用，又天然兼容旧版（旧版无此服务 → `undefined` → 回落 legacy）。

## 4. 最终实现结构（`src/client/index.ts`）

### 4.1 inject（仅两代共有服务）

```ts
export const inject = ['slots', 'locale', 'sessions', 'workspaces']
```

### 4.2 动态探测与特性标志

```ts
const agentPresets = ctx.get('remote.agentPresets') as ... | undefined  // 新版命名空间
const connection   = ctx.get('connection') as ... | undefined          // 旧版句柄
const uiWorkspace  = ctx.get('uiWorkspace') as ... | undefined         // 新版会话启动
const sessions     = ctx.get('sessions')   // 在 inject 中，必有

const hasRemoteNamespace   = agentPresets !== undefined
const hasLegacyApi         = connection?.api !== undefined
const hasUiWorkspace       = uiWorkspace !== undefined
const hasNoteAgentPreset   = typeof sessions.noteAgentPreset === 'function'
```

### 4.3 五个统一封装层（抹平两代差异）

| 封装 | 新版路径 | 旧版路径 |
|---|---|---|
| `listAgentPresets()` → `{ok, presets[], error?}` | `agentPresets.list()`（RemoteResult，扁平化） | `connection.api.agentPresets.list({})`（`result.value`） |
| `selectAgentPreset(id, preset)` → `{ok}` | `agentPresets.select(id, preset)` | `connection.api.agentPresets.select({sessionId, agentPreset})` |
| `startSessionCompat(id)` | `uiWorkspace.startSession(id)` | `workspaces.startSession(id)` |
| `getAgentPreset(summary)` | `projectionValues.agentPreset`（null→undefined） | `summary.agentPreset` |
| `noteAgentPresetCompat(id, preset)` | 空操作（投影自动同步） | `sessions.noteAgentPreset(id, preset)` |

### 4.4 三个调用点全部走封装层

- `checkPreset`（对话框预检）→ `listAgentPresets()`
- `refreshRoster`（变体映射轮询，60s）→ `listAgentPresets()`
- `maybeBind`（空白 WSL 会话自动绑定 `wsl-<mode>` 变体）→ `selectAgentPreset()` + `noteAgentPresetCompat()`

## 5. 逐版本适配验证（对照 DSH 源码 = master v0.1.3-alpha.1）

| 插件假设 | DSH 源码证据 | 新版 | 旧版 |
|---|---|---|---|
| `inject` 四服务名存在 | `ui-workspace` client `inject: ['slots','sessions','workspaces','locale',…]` | ✅ | ✅（已核实） |
| `uiWorkspace.startSession(id?)` | `navigation.ts` `super(ctx,'uiWorkspace')` + `startSession` | ✅ | —（回落） |
| sessions 摘要含 `blank/cwd/projectionValues` | `session-controller/.../service.ts` | ✅ | `agentPreset` 直接字段 |
| `workspaces.create({path}) → {workspaceId}` | `workspace-controller/.../service.ts` `create` | ✅ | ✅ |
| `remote.agentPresets` 可经 `ctx.get` 直取 | gateway 按 `remote.<ns>` 注册；`ctx.get` 全局直查 | ✅ | —（undefined） |
| `select(sessionId, presetId)` 两参 | 官方 `ui-agent-preset/seat-store.ts` 同款 | ✅ | — |
| `list()` → `{ok, value: AgentPresetRoster}` | 官方 `settings-store.ts` `readRoster` | ✅ | — |

## 6. 验证状态与遗留动作

- [x] 源码改造完成（`src/client/index.ts`，浏览器端）
- [x] `package.json` `dsh.compatibility.dshReleases` 声明 0.1.0-rc.7 ~ 0.1.3-alpha.1
- [ ] **重新构建**：`npm run build`（`src/client/index.ts` 最后修改晚于 `lib/client.js`，当前产物仍为报 `without inject` 的旧版）
- [ ] 新版本运行时验证（v0.1.2-rc.1+ / v0.1.3-alpha.1）：GUI 加载无错、空白 WSL 会话自动绑定变体
- [ ] 旧版本运行时冒烟（v0.1.1-rc.2 及更早）：走 legacy 分支
- [ ] Host 面 `docs/compatibility-evidence.md` 的验证矩阵补跑 v0.1.3-alpha.1（`scripts/verify-dsh-compat.sh`）

## 7. 变更记录

- **v0.4.1（本次）**：agentPresets 访问改为 `ctx.get('remote.agentPresets')` 命名空间直取，消除 Cordis associate 陷阱导致的 `cannot get property "remote.agentPresets" without inject`；`inject` 收敛为两代共有四服务；新增 `listAgentPresets`/`selectAgentPreset` 封装并替换三处调用点；声明兼容至 v0.1.3-alpha.1。
- **v0.4.0（早期）**：识别 v0.1.2-rc.1 客户端服务重组；草案 `ADAPTATION_PLAN.md`（硬切换方向，含已证伪假设）**已废弃删除**；`ADAPTATION_PLAN_V2.md` 的新 API 分析并入本文第 2/5 节后删除。
