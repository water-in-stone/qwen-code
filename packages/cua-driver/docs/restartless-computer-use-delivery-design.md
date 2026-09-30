# Qwen Code Computer Use Restartless 交付设计

**状态：** 已在 `2f12a1fe817eb10740a224d15ae5b6c0b9dddfd1` 之上完成实现与源码验证

**日期：** 2026-09-29

**范围：** Qwen Code 本地 Computer Use 的首次交付。本文覆盖如何在 workspace
之外安装固定版本的 Node REPL 与 CUA SDK、如何把 MCP server 动态连接到当前
会话，以及如何在不重启 Qwen Code、不重新打开 conversation 的情况下继续原任务。

**相关文档：**
[Computer Use 竞争分析](computer-use-competitive-analysis.md)、
[Typed browser facade 设计](../../../docs/design/2026-09-13-typed-browser-facade-and-skill.zh-CN.md)
和 [Computer Use 用户文档](../../../docs/users/features/computer-use.md)。

## 1. 源码审计结论

commit `2f12a1fe817eb10740a224d15ae5b6c0b9dddfd1` 实现了 typed
`@qwen-code/cua-sdk/browser-use` facade，但没有实现 Restartless Computer Use
交付。

在该 commit 上，bundled `computer-use` Skill 仍要求模型执行：

```bash
qwen mcp add --scope user node-repl npx -y @qwen-code/node-repl-mcp@0.1.7
npm install --no-save --package-lock=false @qwen-code/cua-sdk@0.20.11
```

该流程会：

- 修改 user MCP configuration；
- 把 SDK 安装到当前 workspace；
- 依赖 workspace 可写；
- 要求用户重启 Qwen Code 后才能使用新增的 MCP tool；
- 在多个 workspace 重复安装产品依赖。

旧版本文档把 `ComputerUseRuntimeManager`、签名 platform broker、generation
lease、operation WAL、desktop FIFO arbiter 和 result store 等远期架构都列为 v1
验收条件。当前源码没有这些 owner 或 symbol，因此旧文档描述的是未实施的未来
架构，而不是可以在当前分支闭环的交付方案。

当前源码已经具备 Restartless v1 所需的较小能力：

```text
Config.addRuntimeMcpServer()
  -> McpClientManager.addRuntimeMcpServer()
  -> connect and discover tools
  -> mcp-client-update
  -> LlmClient.setTools()
```

本设计复用这条现有链路，不新增 daemon 或 broker。

## 2. 决策

Qwen Code 在 session 启动时注册稳定的 built-in `computer_use_setup` tool。首次
使用时，该 tool：

1. 在用户 home 下的 Qwen 产品目录安装固定版本依赖；
2. 校验 package version、Node REPL entrypoint 和 native payload；
3. 将 Node REPL 注册为 runtime-only MCP server；
4. 发现 MCP tools，并刷新当前模型的 tool set；
5. 返回 Skill 下一步应调用的完整 MCP tool name。

整个过程不退出当前 Qwen process，也不更换 conversation。Node REPL process
和 CUA native runtime 可以在内部启动或重启。

固定版本为：

| Package | Version |
| --- | --- |
| `@qwen-code/node-repl-mcp` | `0.1.6` |
| `@qwen-code/cua-sdk` | `0.20.11` |

当前 checkout 中 Node REPL 源码版本已经是 `0.1.7`，但在本次实现时该版本尚未
发布。managed local runtime 固定使用已经发布、足以支持本地 Node REPL contract
的 `0.1.6`。独立的 desktop relay 继续跟随 Node REPL 源码 package version。
release validation 会确认 managed pin 与用户文档一致；如果 pin 不是本次 workflow
准备发布的 Node REPL version，还会确认它已经存在于 registry。

runtime MCP server name 固定为 `computer-use-node-repl`，主要 tool name 为：

```text
mcp__computer_use_node_repl__node_repl
```

## 3. 目标

1. 本地首次 setup 不要求重启 Qwen Code。
2. 同一 conversation 能继续原始 desktop task。
3. 不修改 workspace、manifest、lockfile 或 workspace `node_modules`。
4. 不修改 user MCP configuration。
5. package name、version、安装位置和 server name 均由产品源码固定。
6. 后续 setup 复用已验证 runtime。
7. 并发首次 setup 不会发布半安装 runtime。
8. setup 返回前，当前 session 已完成 MCP discovery 和 model tool refresh。
9. 现有 remote desktop relay 与 user-managed Node REPL 仍可使用。
10. typed CUA facade 继续负责 action uncertainty；不自动重放结果未知的 action。

## 4. 非目标

v1 不负责：

- 提供 Qwen 自有签名 macOS TCC identity；
- 新增长期运行的产品 broker 或 daemon；
- 实现跨 process lease、generation switching、mutation WAL 或 result store；
- 修改 CUA Driver action semantics 或 authorization；
- 绕过 Qwen tool approval 或 OS native permission prompt；
- 在 bare mode、safe mode、execution environment、shell sandbox、SDK mode、
  ACP/headless session 或 subagent 中启动 managed setup；
- 允许模型选择 package、version、path、command、environment 或 server name；
- 在 package 或 native payload 均未缓存时承诺离线首次启用。

macOS 本地 Computer Use 仍继承启动 Qwen 的 Terminal 或 IDE identity。稳定签名
产品 identity 需要 signed application packaging，不能由本次 core TypeScript
改动完成。

## 5. Stable Setup Tool

### 5.1 注册

`computer_use_setup` 是 built-in core tool：

- 仅注册到 top-level local interactive session；
- 不进入 bare、safe、execution environment、shell sandbox、SDK、ACP/headless
  或 subagent registry；
- 不受 `tools.eager` defer 影响，因此 Skill 首次使用前即可调用；
- 仍服从显式 `tools.core` 和 deny 配置；
- 声明为 `Kind.Other`；
- Plan Mode 在 permission evaluation 阶段返回 `deny`，`execute()` 时再次检查，
  防止 mode 切换 TOCTOU；
- 默认 permission 为 `ask`，因为它会写产品目录、执行 npm lifecycle script 并
  启动 MCP process。

schema 不接受任何模型可控安装参数：

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {}
}
```

### 5.2 产品 runtime 目录

runtime 路径为：

```text
~/.qwen/computer-use/runtimes/
  node-repl-0.1.6_cua-sdk-0.20.11/
    node_modules/
    package.json
    ready.json
```

路径直接基于 `os.homedir()`，不继承 `QWEN_HOME`、当前 cwd 或 workspace。workspace
级配置不能把产品依赖重定向到项目目录。

`ready.json` 记录 format 与固定 package version。runtime 只有在以下条件全部
满足时才能复用：

- `ready.json` format 和 version 正确；
- 两个 installed package manifest 的 version 正确；
- `@qwen-code/node-repl-mcp/dist/index.js` 是 regular file；
- installed CUA SDK 能为当前 platform 解析出完整 native payload。

如果 package 完整但 SDK native cache 被清理，setup 会执行已安装、同版本且带
checksum 校验的 `scripts/install-native.mjs`，然后重新验证 native payload。
package runtime 损坏时 fail closed，不在可能仍被其他 process 使用时静默覆盖。
错误会返回损坏的 versioned directory；用户删除该目录后可重新 setup。

### 5.3 Failure-atomic 安装

每次安装使用独立 sibling staging directory：

```text
.node-repl-0.1.6_cua-sdk-0.20.11.<pid>.<random>
```

installer 执行：

```bash
npm install \
  --prefix <staging-directory> \
  --no-save \
  --package-lock=false \
  --omit=dev \
  --ignore-scripts=false \
  --audit=false \
  --fund=false \
  @qwen-code/node-repl-mcp@0.1.6 \
  @qwen-code/cua-sdk@0.20.11
```

优先使用当前 Node executable 同目录的 `npm`/`npm.cmd`；不存在时才回退到
`PATH`。lifecycle script 必须启用，因为 CUA SDK postinstall 负责下载并校验
platform-native payload。

安装完成后依次执行 package 校验、native 校验、写入 `ready.json`，最后将
staging directory 原子 rename 到 final versioned path。

并发 attempt 各自在独立 staging 中安装。第一个成功 rename 的 attempt 成为
winner；其他 attempt 验证并复用 winner，然后只删除自己的 staging。失败或取消
不会发布 final path。

调用方 `AbortSignal` 会终止 npm child。cleanup 只操作本次 attempt 创建的
staging directory。

### 5.4 Runtime-only MCP 注册

固定 `MCPServerConfig` contract 为：

- command：当前 `process.execPath`；
- args：已验证的 Node REPL entrypoint；
- cwd：final runtime root，使 bare import 能解析
  `@qwen-code/cua-sdk`；
- `trust: false`：server process 由产品固定，但 `node_repl` 执行
  model-authored JavaScript，仍保留 Qwen 正常 MCP approval；
- `scope: 'system'`：不是 workspace 提供的 server；
- `alwaysLoadTools: true`：新发现的 Node REPL tools 不进入 ToolSearch defer。

注册只存在于当前 session 的 runtime overlay，不写 settings。后续 Qwen session
重新注册 server，但复用已安装 runtime。

`McpClientManager.addRuntimeMcpServer()` 完成 connect 与 discover 后，
`computer_use_setup` 在返回前显式调用 `LlmClient.setTools()`，确保当前
interactive session 的下一次 model turn 能看到 managed tools。

## 6. Skill 选择顺序

bundled `computer-use` Skill 按以下顺序选择 Node REPL：

1. 已连接的 `desktop-node-repl`；
2. Qwen-managed `computer-use-node-repl`；
3. 已存在的 user-managed `node-repl`；
4. 前三者都不存在时调用 `computer_use_setup`。

setup 返回后，Skill 在下一 model turn 继续调用
`mcp__computer_use_node_repl__node_repl`。它不再调用 `qwen mcp add`，不在
workspace 执行 `npm install`，也不再要求用户重启。

Code Mode 中，第一次 outer `exec` 调用：

```js
const setup = await tools.computer_use_setup({});
text(setup.output);
```

该 cell 随后结束。下一 model turn 使用新出现的 managed MCP binding。

setup tool 只负责交付和连接 execution environment。Skill 与 typed SDK 继续
负责：

- persistent REPL state；
- typed `ComputerUse` 和 `App` operation；
- action 前后的 application state observation；
- uncertain action 之后先观察再决定是否发起新的 action；
- Code Mode 中正确转发 image content。

## 7. Failure Semantics

| Failure | Result |
| --- | --- |
| npm 或 Node 不可用 | 返回底层 actionable error |
| package download/postinstall 失败 | setup 失败并删除 staging |
| package version 或 entrypoint mismatch | fail closed |
| native cache 缺失 | 执行 installed SDK 同版本 repair，并重新验证 |
| 并发 process 先发布 final runtime | 验证并复用 winner |
| MCP connect/discovery 失败 | setup 失败；不写 settings |
| Plan Mode | 在产生 side effect 前拒绝 |
| cancellation | 终止 npm，删除本 attempt staging |
| OS permission 缺失 | CUA SDK 初始化或 action 返回原始错误；Qwen 保持运行 |
| desktop action outcome 不确定 | 先观察实际状态，不自动重放 |

package 安装成功不等于 desktop permission 已授权。Accessibility、Screen
Recording、UIAccess 和 Linux desktop permission 仍由对应平台处理。

## 8. 实施范围

| File | Change |
| --- | --- |
| `packages/core/src/tools/computer-use-setup.ts` | 安装、校验、repair 并连接 managed runtime |
| `packages/core/src/tools/computer-use-setup.test.ts` | runtime、tool、registration 测试 |
| `packages/core/src/tools/tool-names.ts` | stable tool 与 display name |
| `packages/core/src/config/config.ts` | top-level interactive 注册 |
| `packages/core/src/permissions/permission-manager.ts` | eager visibility exemption |
| `packages/core/src/permissions/rule-parser.ts` | stable permission aliases |
| `packages/core/src/skills/bundled/computer-use/SKILL.md` | restartless bootstrap 与 server priority |
| `packages/core/src/skills/bundled/computer-use/SKILL.test.ts` | Skill contract 测试 |
| `docs/users/features/computer-use.md` | 用户文档 |
| `.github/workflows/cd-cua-driver.yml` | managed pin release validation |
| `scripts/tests/release-workflow.test.js` | release regression test |

不需要修改 Cua Driver Rust 或 typed facade。

## 9. 验证

### 9.1 单元测试

测试必须证明：

1. valid ready runtime 不会重复运行 npm；
2. 首次安装只从 staging 发布 verified runtime；
3. package version 或 entrypoint mismatch fail closed；
4. install failure 会清理 staging；
5. runtime path 不继承 `QWEN_HOME`；
6. native payload 缺失时先 repair，再复用 runtime；
7. 并发首次安装只发布一个 valid winner；
8. tool 注册固定 MCP config，并刷新 active model tools；
9. Plan Mode 不触发安装或 MCP 注册；
10. bare、safe、shell sandbox、execution environment、SDK、headless 和
    subagent registry 不包含 setup tool；
11. Skill 不包含 workspace install、`qwen mcp add` 或 restart step；
12. Skill priority 为 desktop relay、managed runtime、user runtime。

### 9.2 Build 与静态检查

```bash
cd packages/core
npx vitest run src/tools/computer-use-setup.test.ts
npx vitest run src/skills/bundled/computer-use/SKILL.test.ts
npx vitest run src/permissions/permission-manager.test.ts

cd ../..
npm run test:scripts -- --run scripts/tests/release-workflow.test.js
npm run build
npm run typecheck
npm run lint
```

### 9.3 真实 package/MCP smoke

使用临时 HOME：

1. 安装真实 fixed npm packages；
2. 校验 `ready.json`、final entrypoint 和无残留 staging；
3. 启动 installed Node REPL MCP server；
4. 确认列出五个 `node_repl*` tools；
5. 通过真实 `node_repl` 动态导入
   `@qwen-code/cua-sdk/computer-use`。

本次验证中，默认 GitHub native asset 下载超过 SDK installer 固定的 120 秒
timeout，setup 正确 fail closed。随后使用同一 `0.20.11` release 的 SHA-256
校验资产，通过 `QWEN_CUA_SDK_NATIVE_DIR` 预置后，真实 npm install、MCP
handshake、五个 tool discovery 和 typed SDK import 均通过。

### 9.4 本地产品 E2E

在 clean temporary HOME 与 disposable workspace 中：

1. 记录 workspace 与 user MCP settings hash；
2. 在 interactive Qwen 中调用 `$computer-use`；
3. approval `computer_use_setup`；
4. 确认 runtime 位于 `~/.qwen/computer-use/runtimes`；
5. 确认同一 Qwen PID、session 和 conversation 的下一 turn 已出现
   `mcp__computer_use_node_repl__node_repl`；
6. approval managed `node_repl`，初始化 `ComputerUse` 并读取一个 app state；
7. 确认 workspace 与 MCP settings hash 未变化；
8. 新 session 复用同一 runtime。

OS Accessibility、Screen Recording 或 UIAccess 必须在真实 interactive desktop
由操作者验证。CI 或无交互 smoke 不能证明这些 OS permission 行为。

## 10. 验收标准

以下条件全部成立，才可宣称 Restartless Computer Use v1 实施完成：

1. supported top-level local interactive session 首次请求前已有
   `computer_use_setup`。
2. setup 不接受模型选择的安装或 process 参数。
3. 首次 setup 只发布 exact-version、package/native 均已验证的 runtime。
4. 重复 setup 不重复安装 package；native 缺失时执行同版本 repair。
5. 并发首次 setup 不会发布 partial runtime。
6. runtime path 独立于 workspace 和 `QWEN_HOME`。
7. setup 不写 user MCP configuration。
8. managed Node REPL 通过 runtime-only MCP 注册。
9. setup 返回前完成 active model tool refresh。
10. bundled Skill 不要求用户重启 Qwen Code。
11. Plan、bare、safe、sandbox、SDK、ACP/headless 和 subagent 无法发起
    managed setup。
12. desktop relay 与 user-managed Node REPL 路径保持可用。
13. typed Computer Use action error 不被自动重放。
14. focused tests、release test、build、typecheck 和 lint 全部通过。
15. 文档明确 launcher-owned OS identity 未改变，不声称已获得 signed product
    identity。
