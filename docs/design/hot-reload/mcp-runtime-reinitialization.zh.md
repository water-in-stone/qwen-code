# MCP 服务运行时热更新设计：settings 驱动的增量重连 (Issue #3696 Sub-task 3)

> 注：sub-task 3 原始范围为 “MCP/LSP” 运行时重连；本 MR 只实现 **MCP**，LSP 仅保留 Part C 的简述 + TODO，留待后续 MR。

## Context

Issue #3696 是热更新系统的总跟踪 issue。Sub-task 1（通过 `SettingsWatcher` 实现 settings
文件变更检测）已合并，但**还没有任何订阅者**——`gemini.tsx:784` 启动了 watcher，而
[Sub-task 1 方案](./settings-change-detection.zh.md)明确把监听器接线留给了"sub-task
2–6"。目前用户在 `settings.json` 中增删改 MCP server（或安装扩展）都必须重启整个会话才能
生效，对话上下文随之丢失。

本 MR 聚焦 **MCP**，交付：(a) 把重新加载后的 settings 推入正在运行的 `Config` 的能力；(b) 由
`SettingsWatcher` 驱动的 MCP 自动重连。LSP 的运行时重连同属本 sub-task，但**本 MR 暂不实现**，
仅在 Part C 留一段简述 + TODO，留待后续 MR 按设计落地。

### 关键发现

我们要做的事是：用户改了配置后，在**不重启会话**的前提下，把受影响的 MCP server 连上 / 断开 /
重连。好消息是——**这套"只处理有变化的部分"的核心逻辑，代码里早就实现了；我们不需要重写它，
只要把它接起来。**

它的工作方式很直白，可以理解成"对账"（先对比、再按差异处理）：把**配置里现在想要的 server
清单**和**当前实际连着的 server**逐一对比，只动有差别的那部分——

- 配置里新增的 → 连上；
- 配置里删掉的 → 断开；
- 配置改了的（换了命令 / 地址等）→ 断开旧连接，按新配置重连；
- 没变化的 → 原封不动，连接和它已经注册的工具都保留。

判断"变没变"靠的是给每个 server 算一个"指纹"（`connectionIdOf(name, config)`，配置一样、
指纹就一样）。这套对账逻辑在两种运行场景下都已具备：

- **共享池模式**（`runDiscoverAllMcpToolsViaPool`，`mcp-client-manager.ts:1461`）：daemon
  模式下，同一个 workspace 里的多个会话**共用**每个 server 的同一条连接（由
  `McpTransportPool` 统一管理、按引用计数回收）。
- **单会话模式**（`discoverAllMcpToolsIncremental`，`:2013`）：没有共享池时的退路，每个会话
  各连各的。有共享池时，它会直接转交给共享池模式处理。

也就是说，"只重连有变化的那几个"已经是现成能力。**我们缺的只有两样：把新配置喂给它，以及一个
触发它的时机。** 它依赖的更底层操作也都现成（我们只是把它们编排起来，并不重写）：

- **连 / 断单个 server**：`McpClientManager.{discoverMcpToolsForServer, disconnectServer,
addRuntimeMcpServer（配置完全相同时什么都不做）, removeRuntimeMcpServer}`。
- **把某个 server 的工具(tools)和提示(prompts)登记 / 注销**：
  `ToolRegistry.{disconnectServer, disableMcpServer, discoverToolsForServer,
removeMcpToolsByServer}`、`PromptRegistry.removePromptsByServer`。

这套对账逻辑**从 `getMcpServers()` 读取想要的 server 清单**。那它现在为什么对改 `settings.json`
毫无反应？唯一的原因是：**`Config` 在启动构造时就给 `mcpServers` 拍了张"快照"定死了**，而且启动
之后再调 `addMcpServers()` 会直接抛错（`config.ts:3200`）——换句话说，目前根本没有"运行中更新这
份 settings 配置"的入口。补上这个入口，正是本方案 Part A 的核心。

### 决策

- **范围**：本 MR 只做 **MCP**——core 原语 **+ settings 自动触发**。LSP 同属本 sub-task，但
  **本 MR 暂不实现**，仅留简述 + TODO（见 Part C），下个 MR 再做。
- **MCP 策略**：增量 diff（复用已有的指纹 reconcile——**不**使用全量清空的
  `restartMcpServers()`）。
- **准入对齐**：共享池路径必须与单会话路径**一样卡 pending 审批**——当前池路径漏查
  `isMcpServerPendingApproval`，本 MR 在此补齐，确保热更新不会在用户审批前连上 gated server
  （详见 Part A 第 4 点）。这是确定的设计决策，不是可选项。

### ⚠️ 补充信息

> **1. 喂给 `setMcpServers()` 的是「合并后的完整配置」，不是 settings.json 原文，也不是连接实例。**
> MCP server 的来源有好几处（用户 settings、项目 `.mcp.json`、workspace/system、`--mcp-config` / session），
> 必须先用 `assembleMcpServers(...)` 按优先级合并成一张完整清单再传进去——直接拿 settings.json 原文会漏掉
> 高优先级来源。这张清单只是**纯配置**，传进去时不连接、不启动任何进程；而且它只替换 settings 这一层，
> 扩展贡献和 runtime 两层由 `getMcpServers()` 照旧叠加，不受影响。
>
> **2. 连 / 断由增量 reconcile 处理，只动有变化的那几个，别全量重来。**
> `setMcpServers` 只是换掉配置快照；真正连 / 断的活儿由 `reinitializeMcpServers()` 触发的增量 reconcile 完成：
> 新增的连上、删除的断开、改了的重连，**没变的连接原样保留**。所以**不要**用 `restartMcpServers()`——
> 它会把所有连接全断了重连，中途还会出现「0 个 MCP 工具」的空窗。

---

## 设计

整体思路：**Part B 在 CLI 层负责「何时触发」，Part A 在 Core 层负责「如何更新 + reconcile」**。
下图是一次 settings 变更从「磁盘文件」到「连接生效」的完整数据流（`[CLI]` = Part B，
`[Core]` = Part A，`[sub-task 1]` = 已合并的 watcher）：

```text
① 用户编辑 .qwen/settings.json（增删改 mcpServers，或 mcp.excluded / mcp.allowed）
       │
       ▼
② [sub-task 1] SettingsWatcher 监听到文件变更
       │   · 300ms debounce：合并连续保存
       │   · 整文件语义 diff：内容真的变了才通知（自写 / 纯格式化不通知）
       ▼
③ [CLI · Part B] registerMcpHotReload 注册的回调被触发（任何 settings 变更都会进来）
       │
       ├─ a. assembleMcpServers(settings.merged.mcpServers, cwd, topTier)
       │        → 按优先级合并成完整 server 清单 next（含 .mcp.json / --mcp-config / session）
       ├─ b. 重算连接准入名单 nextGating = { excluded, allowed, pending }
       └─ c. gate：mcpServersEqual(旧, next) 且 mcpGatingEqual(旧, nextGating) 都「未变」
                → 提前 return（忽略主题 / skills 等与 MCP 无关的编辑）
       │（mcpServers 或 mcp 准入名单「任一」变了才继续 ↓）
       ▼
④ [CLI→Core] 先把连接准入名单推入 config（reconcile 时的 discovery 会读取）：
       config.setExcludedMcpServers / setAllowedMcpServers / setPendingMcpServers
       │
       ▼
⑤ [Core · Part A] config.reinitializeMcpServers(next)
       │   （外层有「reconcile 进行中」守卫，避免与 /reload 竞争）
       ├─ a. setMcpServers(next)：替换 settings 层快照（扩展 / runtime 两层不动）
       └─ b. discoverAllMcpToolsIncremental：对账式增量 reconcile
                · 给每个 server 算 connectionIdOf 指纹，对比「想要的」vs「在线的」
                · 新增 → 连上；删除 → 断开 + 删 tools/prompts；
                  指纹变 → 断开 + 删旧 tools/prompts，再按新配置重连；未变 → 原样保留
                · 跳过 disabled / pending / 未受信任目录；emit mcp-client-update
       │
       ▼
⑥ [CLI · Part B] UI 收尾：mcp-client-update 刷新 MCP 状态指示；
       （可选）MCP prompts 变化 → reloadCommands()；置 needsRefresh（sub-task 6）
```

**分层原因**：core 包不该懂 CLI 的 `settings.json` / watcher 语义——**「何时触发」放 CLI（Part B），
「如何更新 + reconcile」放 Core（Part A）**，与 sub-task 1 的分层决策一致。Part B 是 Part A 的唯一
消费者，两者只通过 `Config` 的方法对接。

> **触发时机的两个层次**（勿混淆）：`registerMcpHotReload` 函数本身只在**启动时执行一次**
> （在 `gemini.tsx` 的 `settingsWatcher.startWatching()` 之后），作用仅是「挂上监听」并返回
> disposer；它注册的回调（即上图 ③ 起的流程）才在**之后每一次 settings.json 内容变更时**由
> watcher 触发，那才是真正跑 reconcile 的时刻。

> ⚠️ **前置硬依赖：MCP 相关 schema 必须是「hot-reloadable」（步骤 ② 的隐藏开关）。**
> sub-task 1 的 `SettingsWatcher` 有一道「restart-required 抑制门」：若一次变更触及的**所有** key
> 在 `settingsSchema.ts` 里都标了 `requiresRestart: true`，watcher **不发事件**（这些值只在启动读取，
> 热更新无意义）。而 `mcpServers` / `mcp.allowed` / `mcp.excluded` 原本都是 `true`——意味着**只改 MCP
> 配置时回调根本不会被触发**，整个 Part B 形同虚设（仅当顺带改了某个可热更新设置才「碰巧」生效）。
> 因此本 MR **必须**把这三个 key 翻成 `requiresRestart: false`。判定走「最长前缀命中」
> （`isRestartRequiredKey`，`settingsWatcher.ts:55`）+ schema 递归展平（`flattenSchema`），所以：
> 翻**叶子**即可，父节点 `mcp` 与启动期专用的 `mcp.serverCommand` **保持 `true`**——前者不影响
> `mcp.allowed`/`mcp.excluded`（叶子优先命中），后者本就不在 reconcile 输入里。
> 因 这三个 key 均 `showInDialog: false`，翻转**不改变**设置对话框的重启提示行为
> （`SettingsDialog.tsx` 的 `requiresRestart()` 仅作用于对话框内可见的 key），blast radius 仅限 watcher 路径。

下面按 Part A（Core 能力）、Part B（CLI 接线）、Part C（LSP，本 MR 仅 TODO）分述。

### Part A —— Core：让 Config 在运行时可更新 MCP 配置并触发增量 reconcile

**文件：`packages/core/src/config/config.ts`**

1. 新增一个 post-init setter，更新 reconcile 所读取的 settings 快照：

   ```ts
   /**
    * 运行时（热更新）替换 settings 层的 MCP server map。
    * 与 addMcpServers() 不同，它绕过 `initialized` 守卫，并且是 REPLACE
    * （而非 merge），这样移除才能生效。runtime overlay
    * （addRuntimeMcpServer）与扩展贡献不受影响——getMcpServers() 仍会叠加在其上。
    */
   setMcpServers(servers: Record<string, MCPServerConfig> | undefined): void {
     this.mcpServers = servers;
   }
   ```

   `getMcpServers()`（`:3128`）已经在 `this.mcpServers` 之上叠加扩展 + `runtimeMcpServers`，
   所以仅替换 settings 层对 runtime/扩展条目是安全的。

2. **连接准入名单**：决定每个 MCP server 是否放行连接的三份名字名单——`excluded`（禁连）、
   `allowed`（设了则只放行其中的）、`pending`（gated 来源，连接前需用户审批）。它与
   `mcpServers`（服务器配置）分开：前者管「**准不准连**」，后者管「**有哪些、怎么连**」。
   为 `getMcpServers()` / discovery 所查阅的这三份名单新增 setter：`setExcludedMcpServers()`
   已存在（`:3167`）；新增 `setAllowedMcpServers()`（该字段当前为 `readonly`，并在
   `getMcpServers()` 内部用作过滤）以及一个 pending-approval 集合的 setter。

3. 新增一个轻量编排方法：先更新 config，再驱动已有的增量 reconcile，并用一个共享的
   "reconcile 进行中" 守卫包住，使 `/reload`（sub-task 5）与 watcher 不会竞争：

   ```ts
   /**
    * 应用新的 settings 层 MCP map 并增量 reconcile 在线连接
    * （新增的连上、移除的断开、变更的重启；未变更的保持不动）。
    * initialize() 之前调用是安全的 no-op。
    */
   async reinitializeMcpServers(servers: Record<string, MCPServerConfig> | undefined): Promise<void> {
     this.setMcpServers(servers);
     const registry = this.getToolRegistry();
     await registry.getMcpClientManager().discoverAllMcpToolsIncremental(this);
   }
   ```

   `discoverAllMcpToolsIncremental` 已经会判 `isTrustedFolder()`、处理 disabled/SDK
   server，并发出 `mcp-client-update` 以刷新 UI 状态指示。移除的 server → 释放 + 删除
   tools/prompts；指纹变更 → 释放 + 重新 acquire；未变更 → 保持不动。

4. **补共享池路径的 pending 审批检查**（信任边界，本 MR 必须修）：单会话路径会跳过处于
   pending 审批的 server，但有共享池时 `discoverAllMcpToolsIncremental` 会转交给
   `runDiscoverAllMcpToolsViaPool`，而**池路径只跳过 disabled / SDK，不查
   `isMcpServerPendingApproval`**（`mcp-client-manager.ts:1461` 一带）。若不补，daemon /
   共享池模式下一次热更新新增 / 改动 gated `.mcp.json` / workspace server，会在用户审批**之前**
   就为它 acquire 池连接、spawn 进程，绕过 #4615 审批门控。修法：在池路径**构建 `desiredIds`
   之前、以及 acquire 之前**都加上 `isMcpServerPendingApproval` 检查，使其与单会话路径准入
   语义一致。

### Part B —— CLI：订阅 SettingsWatcher → MCP reconcile

**新文件：`packages/cli/src/config/hotReload.ts`**，在 `gemini.tsx` 中
`settingsWatcher.startWatching()`（`:785`）之后接线。

```ts
export function registerMcpHotReload(
  watcher: SettingsWatcher,
  settings: LoadedSettings,
  config: Config,
  topTierMcpServers: Record<string, MCPServerConfig> | undefined,
): () => void {
  return watcher.addChangeListener(async (events) => {
    // 完全按 Config boot 的方式重建——包含 top-tier（CLI/session）来源。
    const next = assembleMcpServers(
      settings.merged.mcpServers,
      config.getTargetDir(),
      topTierMcpServers,
    );
    // 重算连接准入名单（excluded/allowed/pending）——【以热更新时的 settings 为准】，
    // 见下方「准入取向」决策；pending 始终按 #4615 审批门控重算。
    const nextGating = {
      excluded: recomputeExcluded(settings, next),
      allowed: recomputeAllowed(settings, next),
      pending: recomputePending(settings, next),
    };
    // gate：mcpServers 或 mcp 准入名单「任一」发生变化才 reconcile；
    // 两者都没变则提前返回（忽略主题 / skills 等与 MCP 无关的 settings 编辑）。
    const serversChanged = !mcpServersEqual(
      config.getSettingsMcpServers(),
      next,
    );
    const gatingChanged = !mcpGatingEqual(config.getMcpGating(), nextGating);
    if (!serversChanged && !gatingChanged) return;
    // reconcile 之前把连接准入名单推入 config（reinitializeMcpServers 内部的 discovery 会读取它们）。
    config.setExcludedMcpServers(nextGating.excluded);
    config.setAllowedMcpServers(nextGating.allowed);
    config.setPendingMcpServers(nextGating.pending);
    await config.reinitializeMcpServers(next);
    // 通知 UI：MCP prompts 变化 → reloadCommands()；设置 needsRefresh（sub-task 6）。
  });
}
```

> **准入取向决策（与 Codex 第 1 条建议相反，刻意为之）**：热更新**以当前 settings 为准**，
> 不把启动时的 CLI allowlist（`--allowed-mcp-server-names`）作为永久最高优先级压制后续编辑。
> 即用户在会话中改了 `settings.json` 的 `mcp.allowed` / `mcp.excluded`，新值立即生效。
> _权衡_：这意味着一次运行时 settings 编辑**可以**放宽到启动 CLI allowlist 之外——我们接受
> 这个行为，因为它与「settings 热更新即时生效」的产品目标一致，且改 `settings.json` 与改启动
> 参数同属本地用户的可信操作。**pending 审批门控（#4615）不在此让步**：gated 来源的 server
> 无论何时都要先审批（见 Part A 第 4 点的池路径补强）。

复用已有 helper——**不要**重新实现合并逻辑：

- `assembleMcpServers(settings.mcpServers, cwd, topTierMcpServers)`——
  `packages/cli/src/config/mcpServers.ts:27`（与 Config boot 在
  `packages/cli/src/config/config.ts:1812` 处的调用一致）。
- `SettingsWatcher.addChangeListener` 返回取消订阅函数（`settingsWatcher.ts:253`）。
- `config.getSettingsMcpServers()`（`:3124`）作为 `mcpServers` diff 的前像；
  `config.getMcpGating()` 作为准入名单 diff 的前像（一个小的新 getter，返回
  `{ excluded, allowed, pending }`，与 Part A 的 setter 配对）。

gate 用两个小的纯函数收窄触发面，避免无关 settings 编辑（主题、skills 等）触发重复 reconcile，
与 watcher 自身的语义 diff 理念一致。两者都**复用 `fast-deep-equal`**（仓库已作为传递依赖装好；
cli 包需把它提升为**直接依赖**）而非手写深比较：

```ts
import equal from 'fast-deep-equal';

/**
 * 两个 mcpServers map 是否等价。fast-deep-equal 对「对象 key 顺序」不敏感
 * （恰好消除 settings.json 里 server 顺序 / 字段顺序变化的假阳性），但对
 * 数组顺序敏感（`args` 等命令参数顺序本就有语义，正确）。undefined 视同 {}。
 */
export function mcpServersEqual(
  a: Record<string, MCPServerConfig> | undefined,
  b: Record<string, MCPServerConfig> | undefined,
): boolean {
  return equal(a ?? {}, b ?? {});
}

export interface McpGating {
  excluded?: string[];
  allowed?: string[];
  pending?: string[];
}

/**
 * 准入名单是否等价。excluded / allowed / pending 语义是「集合」，顺序无关——
 * 而 fast-deep-equal 对数组是顺序敏感的，所以先排序副本再比。undefined 视同 []。
 */
export function mcpGatingEqual(a: McpGating, b: McpGating): boolean {
  const norm = (xs: string[] | undefined) => [...(xs ?? [])].sort();
  return (
    equal(norm(a.excluded), norm(b.excluded)) &&
    equal(norm(a.allowed), norm(b.allowed)) &&
    equal(norm(a.pending), norm(b.pending))
  );
}
```

`mcpGatingEqual` 正是让「只改 `mcp.excluded` / `mcp.allowed`、不动 `mcpServers`」也能触发
reconcile 的关键，修掉了只比 `mcpServers` 会漏掉准入变更的 gap。

UI 通知回调把"MCP 变更"信号经由已有的 `mcp-client-update` 事件路由（状态指示已订阅），
和/或通过 app-state 的 `needsRefresh` setter（sub-task 6）。本 sub-task 的下限是：config 级
reconcile 完成、已有的 emit 刷新状态指示。（端到端数据流见本章开篇的总览图。）

### Part C —— LSP reinitialize（本 MR 暂不实现，TODO）

LSP 的配置来自 `.lsp.json` + 扩展配置（**不是** `settings.json`），所以它**不接 SettingsWatcher
自动触发**；其运行时重连应由后续的 `/reload` 命令（sub-task 5）手动驱动。`NativeLspService`
（`--experimental-lsp` 开关控制）已具备 `discoverAndPrepare` / `start` / `stop` 等生命周期方法，
足以实现一个 `reinitialize()` 原语并经 `LspClient.reinitialize?()` + `Config.reinitializeLsp()`
暴露给 `/reload`，无需大改。

> **TODO（下个 MR）**：实现 `NativeLspService.reinitialize()` 及其经 `Config.reinitializeLsp()`
> 的暴露，并在该 MR 的设计文档里给出详细方案（含 `discoverAndPrepare()` 会先 `clearServerHandles()`
> 导致无法做增量 diff、v1 用 stop-all → start-all 等细节）。**本 MR 不含任何 LSP 代码改动。**

### Part D —— 后续补强：热更新触发 gated server 的运行时审批弹窗（衔接 #4615）

> 本节是 Part A/B 落地后、排查「改了 gated server 的 URL 却不重连」时补上的一块。它修复了
> 「热更新把 gated server 打成 pending，但交互界面不弹批准框」的断点，并顺带修掉一个由判定逻辑
> 引起的漏弹（下文 issue #6）。

#### 背景：审批弹窗原本只在启动期算一次

gated 来源（`project` 的 `.mcp.json` 与 `workspace` 的 `.qwen/settings.json`，见
`isGatedMcpScope`）的 server，其用户批准是**绑定到 config hash** 的（`mcpApprovals.ts` 的
`getState`：无记录、或记录 hash 与当前 config 不符 → `pending`）。因此一次热更新若改动了某 gated
server 的配置（哪怕只是 `httpUrl`），它的 hash 变化会让旧批准失效、重新变 `pending`。

Part A/B 的链路对此**已正确**：`recomputeMcpGating` 把它算进 `pending`，`setPendingMcpServers`
推给 discovery，reconcile 时跳过它（不连接，状态 `disconnected`）。但**交互界面不弹批准框**——
根因是 `useMcpApproval`（驱动批准弹窗的 hook）的队列只在**挂载时**用 `useEffect(…, [config])`
计算一次，而 `config` 引用整会话不变 → effect 永不重跑。也就是说：

- core 层把 server 标成 pending（discovery 跳过）✓
- UI 层的批准队列从不重算 → **不弹窗** ✗（用户只见 `disconnected`，无从批准）

两条路径在运行时是**断开**的。

#### 修复：core→UI 用事件接起来，判定权交给 UI

1. **新增事件** `AppEvent.McpPendingApprovalChanged`（`packages/cli/src/utils/events.ts`）。
   因 `appEvents` 在 CLI 层、`hotReload.ts` 也在 CLI 层，监听器可直接 emit，**无需改动 core**。

2. **`hotReload.ts` 在 reconcile 之后 emit**（放在 `await reinitializeMcpServers` 之后，使
   `config.getMcpServers()` 已反映新 map；无论 reconcile 成败都 emit——留 pending 的 server 仍
   需用户决策）。

3. **`useMcpApproval` 抽出 `computePending()`**：挂载时算一次（原有行为）**＋** 订阅
   `McpPendingApprovalChanged` 后重算队列 → 队列非空即弹窗。`computePending` 从权威来源
   （实时 server map + 持久化批准文件）重算，故已批准 / 已拒绝的不会被重复弹。

#### 关键设计：用「严格 pending」判定 emit，而非名字差集（issue #6 / A1 决策）

注意两个 predicate **故意不同**，是本节的核心：

| 函数                                  | 判定                                       | 用途                                    |
| ------------------------------------- | ------------------------------------------ | --------------------------------------- |
| `getPendingGatedMcpServers`           | `state !== 'approved'`（**含 rejected**）  | 喂 discovery：rejected 也要继续**跳过** |
| `getPromptableMcpServers`（本次新增） | `state === 'pending'`（**不含 rejected**） | 喂弹窗：rejected **不再骚扰**           |

最初的 emit 判定用「`nextGating.pending` 相对上一次的**名字差集**」来决定是否弹窗，存在漏弹
（review issue #6）：

- 一个被 **rejected** 的 server 因 `!== 'approved'` 始终留在 `pending` 列表里；
- 用户随后**再次编辑同一 server 的配置**（hash 变 → 它确实重新变 `pending`，理应重新征询），
  但它的名字「早就在」列表里 → 差集为空 → **不发事件 → 漏弹**。

A1 修法：改用 `getPromptableMcpServers(next, cwd)`（严格 `=== 'pending'`）决定 emit，判定真相交给
`computePending`。效果：

- reject 后**改同一 server 配置**（hash 变）→ 重新 `pending` → **重新弹窗** ✓（修复 #6）
- reject 后发生**无关**编辑（hash 不变）→ 仍 `rejected` → 非 promptable → **不弹** ✓
- 已 `approved` → 不弹；新增未决 gated server → 弹 ✓

#### reject 的语义（梳理后的确认）

`handleMcpApprovalSelect(REJECT)`：持久化 `rejected`（绑当前 hash）、**不**调用 `reconnect`、
**不**动 `config.pendingMcpServers` → discovery 继续跳过 → server 保持 `disconnected`。无需主动断开
旧连接：emit 在 `reinitializeMcpServers` await 之后，弹窗出现时 reconcile 已把旧连接拆掉。重启会话
后 `computePending` 读到 `rejected` → 不入队、保持断开，行为一致。

#### 数据流补充（接在本章开篇总览图 ⑥ 之后）

```text
⑥' [CLI · Part D] reconcile 后，若存在严格 pending 的 gated server：
        hotReload → appEvents.emit(McpPendingApprovalChanged)
        → useMcpApproval.computePending() 重算队列 → 弹出批准弹窗
        → 用户 approve：approveMcpServerForSession + discoverToolsForServer（按新配置连接）
          用户 reject：持久化 rejected，保持 disconnected
```

#### 关键文件（Part D）

| 文件                                          | 改动                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/utils/events.ts`            | 新增 `AppEvent.McpPendingApprovalChanged`                                                                           |
| `packages/cli/src/config/mcpApprovals.ts`     | 新增 `getPromptableMcpServers()`（严格 `=== 'pending'`，与 rejected-inclusive 的 `getPendingGatedMcpServers` 区分） |
| `packages/cli/src/config/hotReload.ts`        | reconcile 后用 `getPromptableMcpServers` 判定，非空则 `appEvents.emit(McpPendingApprovalChanged)`                   |
| `packages/cli/src/ui/hooks/useMcpApproval.ts` | 抽出 `computePending()`；挂载算一次 ＋ 订阅事件重算                                                                 |

#### 验证（Part D）

- `hotReload.test.ts`：gated server 新进 pending → emit；非 gated 变更 → 不 emit；
  **reject→改配置 → 重新 emit**（旧名字差集逻辑会是 0 次，锁死 #6 回归）；reject→无关编辑 → 不 emit。
- `mcpApprovals.test.ts`：`getPromptableMcpServers` 套件——无决策弹、rejected 不弹（对比
  `getPendingGatedMcpServers` 仍跳过）、改 hash 后重弹、approved 不弹。
- `useMcpApproval.test.ts`：中途事件令新 gated server 弹窗；已批准的不重复弹。

#### 已知问题 / 后期复盘 TODO（本次**未**处理）

1. **`getTargetDir()` vs `getWorkingDir()` 键不一致（风险 B）**：gating 重算
   （`recomputeMcpGating` → `getPendingGatedMcpServers`）用 `config.getTargetDir()` 作 projectRoot，
   而 `useMcpApproval` 的读 / 写批准用 `config.getWorkingDir()`。二者通常相等；一旦分叉（自定义
   cwd、或 symlink 的 realpath 差异），批准写在 cwd-key、gating 查 targetDir-key → **approve 后
   gating 仍跳过、永不连接**。属既有问题、非 Part D 引入。建议统一到同一个 root（倾向 `getWorkingDir()`，
   即审批写入方），或先加断言确认运行时恒等。

---

## 范围之外（其他 sub-task）

- **整个 LSP 运行时重连**（`NativeLspService.reinitialize()` + `Config.reinitializeLsp()` +
  接线）——留待后续 MR，见 Part C 的 TODO。
- `/reload` slash 命令（#5）——调用 `config.reinitializeMcpServers(currentSettings)`（LSP 部分
  待其原语在后续 MR 落地后再接）+ skill/command 重载。
- `clearAllCaches()`（#4）与 `needsRefresh` UI 通知（#6）。

## 关键文件

| 文件                                            | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/config/config.ts`            | `setMcpServers()`、`setAllowedMcpServers()` + pending setter、`getMcpGating()`（返回 `{ excluded, allowed, pending }`）、`reinitializeMcpServers()`（带 reconcile-in-progress 守卫）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/core/src/tools/mcp-client-manager.ts` | ① 在 `removeServer()` 与 `removeRuntimeMcpServer()` 补 `removePromptsByServer()`；② 在共享池路径 `runDiscoverAllMcpToolsViaPool`（`:1461`）构建 `desiredIds` 前 / acquire 前补 `isMcpServerPendingApproval` 检查（与单会话路径准入对齐）；③ **单会话路径补指纹 diff**：新增 `connectionFingerprints` map，`discoverAllMcpToolsIncremental` 对「已连接但 `connectionIdOf` 指纹变了」的 server 也触发断开重连（与池路径 `desiredIds` 对齐），各拆卸路径同步清理该 map；④ **重连前清理旧 tools/prompts**：`discoverMcpToolsForServerInternal` 替换已有 client 时，在重新发现前 `removeMcpToolsByServer` + `removePromptsByServer`——因 `disconnect()` 不碰 registry、`discover()` 只按名追加/覆盖，否则配置变更丢弃/改名的工具会残留并绑在已关闭 client 上（发现失败时同样残留），对齐 `removeServer` / `addRuntimeMcpServer` 的既有清理 |
| `packages/cli/src/config/settingsSchema.ts`     | **前置依赖**：`mcpServers`（`:274`）、`mcp.allowed`、`mcp.excluded` 三个 key 从 `requiresRestart: true` 翻成 `false`，使 watcher 不再抑制 MCP-only 编辑；父节点 `mcp` 与 `mcp.serverCommand` 保持 `true`（见上文「前置硬依赖」note）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/cli/src/config/hotReload.ts` _(新)_   | `registerMcpHotReload()`：用 `assembleMcpServers(..., topTierMcpServers)` 重建；以当前 settings 重算连接准入名单（见「准入取向决策」）；gate 用 `mcpServersEqual` + `mcpGatingEqual`（基于 `fast-deep-equal`）双重判断；debounce + coalesce-and-recheck                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/cli/package.json`                     | 把 `fast-deep-equal` 从传递依赖提升为**直接依赖**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/cli/src/gemini.tsx`                   | 在 `:785` 之后调用 `registerMcpHotReload`；登记 disposer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 测试 _(随 schema 翻转)_                         | `settingsSchema.test.ts` 钉死三个 MCP key 的 `requiresRestart` 值（含 `mcp` / `mcp.serverCommand` 保持 `true`）；`settingsWatcher.test.ts` 新增「只改 `mcpServers` / 只改 `mcp.excluded` → 仍通知」两条正向回归；`settingsUtils.test.ts` 用的是**自带 mock schema**、与真实翻转无关，无需改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

> LSP 相关文件（`NativeLspService.ts` / `NativeLspClient.ts` / `lsp/types.ts`）本 MR 不改动，见 Part C TODO。

## 验证

### A. 核心能力单测（core，`config.test.ts` / `mcp-client-manager.test.ts`）

1. `setMcpServers` 是 **replace（非 merge）** 且 post-init 生效（不再被 `initialized` 守卫抛错）。
2. `reinitializeMcpServers` 先 `setMcpServers` 再调用 `discoverAllMcpToolsIncremental`；在
   `initialize()` 之前调用是**安全 no-op**（不抛错、不连接）。
3. 断言 `removeServer()` / `removeRuntimeMcpServer()` 现在会调用 `removePromptsByServer()`
   （prompt 泄漏回归守卫）。复用 `mcp-client-manager.test.ts` fixtures（已 import `connectionIdOf`）。
   3b. **单会话路径指纹 diff**：一个 `getStatus()` 恒为 `CONNECTED` 的 mock client，跑三趟
   `discoverAllMcpToolsIncremental`——首连记录指纹；同配置重跑 **不** churn（`connect` 仍 1 次）；
   原地改 `args`（指纹变）→ 断开重连（`disconnect` 1 次、`connect` 2 次）。守护单会话路径不再把
   「已连接但配置变了」漏成 no-op（与共享池 `desiredIds` 对齐）。并断言这一趟在重新发现前对该 server
   调了 `removeMcpToolsByServer` + `removePromptsByServer`——守护「重连前清理旧 tools/prompts」，
   防止配置变更丢弃/改名的工具残留（Codex 对抗式 review #2）。

### A'. watcher↔schema 集成守卫（cli，`settingsSchema.test.ts` / `settingsWatcher.test.ts`）

> 这两条是 Codex 对抗式 review 标出的 **high** 级集成断点：MCP-only 编辑会被 watcher 的
> restart-required 抑制门吞掉，导致 Part B 回调永不触发。**必须**有真实 watcher 层的覆盖，
> 仅在 `hotReload.test.ts` 里直接调回调测不到这个失败。

3c. **schema 钉值**（`settingsSchema.test.ts`）：`mcpServers` / `mcp.allowed` / `mcp.excluded` 的
`requiresRestart` 为 `false`；父节点 `mcp` 与 `mcp.serverCommand` 为 `true`。防止有人误把 MCP key
改回 restart-required 从而静默关掉整个热更新。
3d. **真实 watcher 不再抑制**（`settingsWatcher.test.ts`，用真实 `SettingsWatcher` + mock fs）：
只改 `mcpServers` / 只改 `mcp.excluded` 各触发**一次** `SettingsChangeEvent`（翻转前会被抑制）。
这正是 sub-task 3 监听器能被触发的端到端回归守卫。

### B. 订阅器 gate 分支单测（cli，`hotReload.test.ts`）

伪造 `SettingsWatcher`，覆盖 gate 的每个分支：

4. **`mcpServers` 变化** → 以 **assembled** map（含 top-tier）调用 `reinitializeMcpServers`。
5. **只改 `mcp.excluded`（或 `mcp.allowed` / pending）、不动 `mcpServers`** → **仍然**触发
   reconcile，且 reconcile 前已调用 `setExcludedMcpServers` / `setAllowedMcpServers` /
   `setPendingMcpServers`。这条专门验证 `mcpGatingEqual` 分支——即修掉的 gap：只比
   `mcpServers` 时这种变更会被漏掉。
6. **`mcpServers` 与 `mcp` 准入名单都没变**（如改主题 / skills）→ **不**调用
   `reinitializeMcpServers`（验证两个 gate 同时为「未变」时提前返回）。
7. **in-flight reconcile 期间连发两次变更** → coalesce-and-recheck 再跑一次（再入性）。
8. **debounce**：连续多次保存（< 300ms）只触发**一次** reconcile（与 watcher 的 300ms debounce 对齐）。

### C. gate helper 纯函数单测（cli，`hotReload.test.ts`）

9. `mcpServersEqual`：key 顺序不同、值相同 → `true`；嵌套 config 字段（`args` / `env` /
   `headers`）变化 → `false`；`undefined` 与 `{}` → `true`；增 / 删一个 server → `false`；
   `args` 数组顺序变化 → `false`（命令参数顺序有语义）。
10. `mcpGatingEqual`：三个列表「顺序无关」判等（`['a','b']` vs `['b','a']` → `true`）；
    任一列表增 / 删一项 → `false`；`undefined` 与 `[]` → `true`。

### D. 信任边界边界用例（cli + core）

> 两条都源自 Codex 对抗式 review 标出的 **high** 级信任边界点。第 11 条按本设计的「准入取向决策」
> 取向（热更新以 settings 为准）验证；第 12 条对应 Part A 第 4 点（池路径补 pending 检查）。

11. **热更新连接准入以当前 settings 为准**（落实「准入取向决策」）。
    用 `--allowed-mcp-server-names=a` 启动；之后 settings 变更把 `b` 加入 `mcp.allowed`。**断言**：
    reconcile 后按当前 settings 重算的准入名单生效，`b` 变为可见 / 可连——即运行时 settings 编辑**可以**
    放宽到启动 CLI allowlist 之外（这是刻意的产品取向，非缺陷）。
    _守护对象_：Part B 中 `nextGating` 完全由当前 settings 重算，不被启动 CLI allowlist 钉死。

12. **共享池模式下 pending 审批门控不被绕过**（高危：未审批即连上 gated server）。
    daemon / 共享池模式（`runDiscoverAllMcpToolsViaPool`）下，让 settings 热更新新增 / 改动一个处于
    pending 审批的 `.mcp.json` / workspace server。**断言**：在用户审批前**不**为它 acquire 池连接、
    不 spawn 进程；被拒绝的 gated server 保持不连。对比单会话路径已经会跳过 pending，本测试守住池路径。
    _守护对象_：Part A 第 4 点——池路径在构建 `desiredIds` / acquire 之前的 `isMcpServerPendingApproval`
    检查。

### E. reconcile 边界用例（建议覆盖，验证「增量而非全量」）

13. **空 ↔ 非空**：从 0 个 server 加到 1 个（首个）、从 1 个减到 0 个（末个）都正确 reconcile，不残留连接 / tools / prompts。
14. **指纹变更只动单个 server**：改某个 server 的 `command` / `url` / `env` / `headers` → 只它断开重连，**其余连接原样保留**（验证非全量清空、无「0 工具」空窗）。
15. **未受信任目录**：`isTrustedFolder()` 为 false 时，热更新是 no-op（不建立任何连接）。
16. **`mcp.excluded` 切换**：把某在线 server 加入 excluded → 它被断开 + tools/prompts 清除；再移出 excluded → 重新连上。

### F. 手工 E2E

17. 用一个 stdio MCP server 启动会话；运行时编辑 `.qwen/settings.json` 增加第二个 → 其 tools
    无需重启即出现且上下文保留；移除第一个 → 其 tools/prompts 消失、第二个保持连接（验证增量而非
    全量清空）。确认 MCP 状态指示更新。

### G. 全量校验

18. `npm run preflight`（build + lint + typecheck + tests）。
