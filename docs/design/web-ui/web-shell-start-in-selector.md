# Web Shell Start In 选择器

## 概要

实现 #6701：为 Web Shell 的全新会话增加执行上下文选择器，并提供真实的 git worktree 隔离。

- UI 新增紧凑的 `Start In` 选择器：
  - `Work locally`
  - `New worktree`
- `New worktree` 只影响未来创建的全新会话，不影响已加载、已恢复或正在运行的会话。
- daemon 在启动会话前先创建 git worktree。
- bridge 保留 base `workspaceCwd` 作为 workspace 归属与列表/路由 key，同时新增 `executionCwd` 表示子进程和会话实际运行目录。
- ACP bridge channel 改为按 `executionCwd` 分组，确保 local session 和 worktree session 不会复用同一个 child process。

```mermaid
flowchart LR
  UI["Web Shell composer<br/>Start In selector"] --> Prep["sessionPreparation<br/>createSession({ startIn })"]
  Prep --> SDK["SDK CreateSessionRequest<br/>startIn"]
  SDK --> Route["POST /session<br/>base workspace route"]
  Route --> WT{"startIn"}
  WT -->|local| Local["executionCwd = workspaceCwd"]
  WT -->|worktree| CreateWT["创建 .qwen/worktrees/<auto-slug><br/>写入 marker + sidecar + startup notice data"]
  CreateWT --> Exec["executionCwd = worktreePath"]
  Local --> Bridge["Bridge spawnOrAttach<br/>workspaceCwd = base<br/>executionCwd = runtime cwd"]
  Exec --> Bridge
  Bridge --> Channels["ACP channels 按 executionCwd 分组"]
  Channels --> Child["qwen --acp child<br/>cwd = executionCwd"]
  Route --> Catalog["Session catalog/listing<br/>归属于 base workspaceCwd"]
```

## 关键改动

1. 增加 `StartInMode = 'local' | 'worktree'`，并串联到：
   - Web Shell `sessionPreparation`
   - `DaemonSessionActions.createSession`
   - SDK `CreateSessionRequest`
   - daemon `POST /session`

2. bridge 拆分运行时目录语义：
   - `workspaceCwd`：base workspace 归属 key，用于路由、列表、session storage、trust、workspace registry 匹配。
   - `executionCwd`：实际会话运行目录，用于 ACP child spawn、shell command cwd、child-facing status、artifacts，以及所有路径敏感的 session 行为。
   - `SessionEntry` 同时存储两个值。
   - ACP channel 按 `executionCwd` 分组；相同 `executionCwd` 可以复用 channel，不同 worktree/local cwd 必须使用不同 child channel。

3. daemon 创建 worktree session：
   - `startIn: 'worktree'` 时，基于 base repo 使用现有 `GitWorktreeService` 自动创建 worktree。
   - 写入与 CLI worktree session 相同结构的 `WorktreeSession` sidecar。
   - 写入/adopt worktree marker，确保 `exit_worktree` ownership 检查有效。
   - 生成等价于 `buildStartupWorktreeNotice` 的 startup notice，并注入新会话首次 prompt 的初始上下文路径。
   - 如果 worktree 创建、spawn、sidecar 写入、marker 写入或响应交付失败，则关闭刚创建的 fresh session，并 best-effort 删除本次请求刚创建的 worktree。

4. restore 行为：
   - `load` / `resume` route 先解析 base workspace。
   - bridge restore 前读取 base workspace 下的 session sidecar。
   - 如果 sidecar 有效且 worktree 仍存在，则把 `executionCwd` 传给 bridge。
   - 如果没有有效 sidecar，则按 local 恢复：`executionCwd = workspaceCwd`。
   - session list 仍归属于 base workspace，可附带 worktree metadata 供展示/调试。

5. UI 行为：
   - 在 ChatEditor toolbar/dropdown 风格中新增小型 `StartInSelector`。
   - 只有 capability 和 workspace preflight 都表示可用时，才启用 `New worktree`。
   - 不支持时选项仍显示，但 disabled，并通过 tooltip 解释原因。
   - fresh session 创建成功后，选择器重置为 `Work locally`。
   - 对已加载、已恢复、正在运行的 session，不显示也不修改当前 session mode。

## Preflight 与 Capability

- 新增 capability feature flag：`session_start_in_worktree`
- 新增 preflight kind：`worktree`
- daemon 的 `worktree` preflight 检查：
  - git binary 可用；
  - 当前 workspace 在 git repo 内；
  - 可以解析 repo top-level；
  - 当前 cwd 不在 `.qwen/worktrees` 内。

UI 只有在以下条件同时满足时启用 `New worktree`：

- `capabilities.features.session_start_in_worktree === true`
- preflight cell `kind === 'worktree' && status === 'ok'`

## 测试计划

- SDK / webui 单测：
  - `startIn` 能序列化到 `POST /session`
  - `DaemonSessionActions.createSession` 正确转发 `startIn`
  - `sessionPreparation` 带 workspace、approval mode 一起转发选中的 `startIn`

- daemon route 单测：
  - `local` 保持现有行为，`executionCwd = workspaceCwd`
  - `worktree` 创建 auto worktree，写 marker/sidecar，注入 startup notice，并以 base `workspaceCwd` + worktree `executionCwd` 调用 bridge
  - 非法 `startIn`、非 git repo、缺少 git、嵌套 worktree cwd 在 bridge spawn 前失败
  - spawn failure、metadata failure、client disconnect 会清理 fresh worktree/session

- bridge 单测：
  - workspace mismatch 仍基于 base `workspaceCwd` 校验
  - channel 按 `executionCwd` 分组
  - local + worktree、worktree + local、两个不同 worktree 都使用独立 child channel
  - shell command、artifacts、child status 使用 `executionCwd`
  - list/load/resume 仍归属于 base `workspaceCwd`

- Web Shell 单测：
  - selector 渲染并可切换 mode
  - 缺 capability/preflight 时 `New worktree` 禁用
  - first prompt 使用选中的 `startIn` 创建 session
  - active session 期间切换 selector 不迁移、不重建当前 session

## 假设与边界

- V1 只支持裸 `qwen --worktree` 自动 slug 语义；显式 slug 和 PR worktree 不在范围内。
- active session migration 不在范围内。
- 移动端 V1 使用现有 toolbar wrapping，不新增 overflow menu。
- worktree cleanup 只对本次失败请求创建的 worktree 做 best-effort 清理；不会自动删除此前保留或复用的 worktree。
