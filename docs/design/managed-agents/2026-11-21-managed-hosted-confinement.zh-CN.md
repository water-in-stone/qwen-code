# Hosted Workspace Runtime 的隔离

[English](2026-11-21-managed-hosted-confinement.md)

[#15081](https://github.com/QwenLM/qwen-code/issues/15081) · [#14667](https://github.com/QwenLM/qwen-code/issues/14667) · [初始设计](https://github.com/QwenLM/qwen-code/pull/15163)

## 范围

Broker 可以显式为本地、持久且 Session 独占的 Hosted Workspace Runtime 启用 Linux 私有根。本阶段通过独立的 `hosted-workspace-confined-shell/1` profile 的有界 Tool v2 结果通道，为绑定到已登记 Workspace 根目录的内置 Agent Session 开放前台 Shell。命令可访问授权的 `/workspace`、部署提供的只读镜像和私有临时目录，网络关闭。原生文件工具、进程服务和可执行扩展需要独立的准入设计。

选定的 Worker 继续作为可信的宿主控制进程，使用现有的本地回环认证协议。每条通过准入的命令均由私有根启动器执行。Worker、启动器和命令都在原 Runtime cgroup 内，生命周期清理可在 Worker 不响应时证明整个 Runtime 已停止。

## 选择与配置

显式配置 `qwen.managed-agent.runtime-broker.provider-options.private-rootfs` 启用此能力。该选项指向部署方管理的规范绝对镜像路径，镜像提供可执行的 `/bin/sh`。它要求规范的 `/usr/bin/bwrap`、现有 `qwen.managed-agent.runtime-broker.provider-options.cgroup-root` 选项、持久的 local-process provider、Linux、非特权服务账号和 Session 独占。同时要求关闭结果发布、可执行扩展、子 Workspace、子 Agent 和网页终端。首个版本支持未配置模型侧扩展、Hook、MCP、客户端文件、Skill 或进程服务的内置 Agent。不符合条件的本地位置收到类型化拒绝。外部和 SSH 位置保持独立能力，不宣称提供本隔离保证。Broker 进程运行期间该设置不可变，本阶段以 Bubblewrap 0.8.0 验证。部署切换前必须暂停准入并清理现有本地 Runtime 租约。部署方提供稳定且互不重叠的根目录，排除宿主套接字、设备节点、嵌套挂载以及指向受保护文件的硬链接。镜像和可执行文件是可信部署资产。

配置启用后，新建本地内置 Agent Workspace Session 在 Workspace 创建锁内将 `hosted-workspace-confined-shell/1` 写入现有 profile 字段，并拒绝不满足的先决条件、非根 cwd 或可选工具配置。该 profile 由内置准入逻辑决定。控制面只为符合条件的本地 Workspace 与保存的隔离 profile 选择保留的能力摘要。现有普通 Session 保留原 profile。启用期间，匹配本地部署范围的已有普通 Session 仍可恢复及清理原工作。新的预热、获取、预留与分派均要求保存的隔离 profile。关闭启用配置后，隔离 Session 无法预热或获取普通替代 Runtime。持久化作用域和 Worker 启动及证明与普通、外部、SSH、驻留和扩展模式分开。普通能力之间的绑定兼容规则不适用于此能力的双向切换。现有数据库 schema 已支持该 profile 名称。

本地 v3 注册将私有根配置与原 cgroup 身份一起记录，包括镜像的规范路径、镜像和固定 Bubblewrap 二进制各自的设备及 inode 身份，以及协议版本。首次注册从当前配置生成；读取已有注册时按记录的配置重建句柄，并与 Broker 句柄比较。启动与证明使用完全相同的配置。服务端与 Worker 在启动、收养和准入时比较当前配置与记录。镜像内容在绑定生命周期内是不可变部署资产，路径身份无法证明内容未变。清理始终重建原 cgroup 句柄，配置变更后仍可执行。隔离请求缺失 v3 句柄或持有其他版本的句柄时，不能走旧的 PID 停止路径。变更模式或镜像前需要先清理受影响的旧租约。位置准入需要验证 Workspace 的存储身份。启用隔离的绑定要求使用 cgroup 句柄才可启动。现有绑定和新绑定的准入均比较解析所得的作用域；清理使用已保存的作用域，与当前启动资格无关。

部署配置通过可信启动协议进入 Worker。Worker 结合能力、配置和 Workspace 根验证身份，并在证明成功前执行有时间上限的隔离空操作来验证 Bubblewrap。ready 记录只发布控制端点。Worker 仅在证明请求通过认证且身份匹配时返回精确的资格错误，Java 传输层保留该错误。资格失败时上下文安装和工具准入均保持关闭。验证失败返回 `managed_runtime_confinement_unavailable`，并保持绑定的所有权约束。后续启动失败也不会改用普通执行器重试同一命令。

## 准入与工具结果

Hosted Connector 在创建、加载与恢复时传递已保存的隔离 profile，包括禁用启动后。活跃附件的 Harness 只启用 v2 前台 Shell 结果通道，并在预热和工具准入前核对 Broker 的确切能力。Harness 与 Java 独立识别该 profile，并纳入生命周期 v2 协商。清理附件不预热，也无需探查当前启动能力。控制面门禁和封闭的 Worker 路由也约束旧 Harness，阻止选定 Runtime 降级。清理和取消沿用保存的作用域，准入不扩大。模型只看到 Shell 声明，其他名称在分配执行预留、解析可扩展工具或执行宿主辅助操作之前被拒绝。Broker 与选定 Worker 在分派前独立执行允许清单，包括直接提交的 Tool v2 请求。保存的 Session 必须位于根目录 "."。Shell 不接受选择目录、后台或监控模式。Harness 为隔离路径关闭文件历史的绑定和恢复，也不读取项目指令文件。前台 Shell 继续使用保存的审批模式（default 或 auto-edit）、审批提示和仅 owner 可答复审批的规则。该模式不提供 Plan 或动态审批切换。准入时不支持的操作返回 `managed_runtime_confinement_denied`。请求未声明的 Worker 端点时沿用原有的路由未找到响应。

隔离 Worker 只开放证明、安装、激活、Tool v2 执行、结果、取消及确认路由。激活路由的 release 操作关闭逻辑 Session，无需发起 Provider 请求。Provider 分派、Tool v3/v4、文件及撤销、MCP、Hook、后台及发布、扩展、Monitor 和终端等路由不能在隔离 Worker 执行，也不能为该 Session 切换到其他 Worker 执行。Worker 通过 Bubblewrap 让固定的 `/bin/sh -c` 作为新 PID namespace 的 PID 1 执行。Bubblewrap 等待该 namespace 的 init 退出才报告关联状态，Linux 在退出过程中收割该空间的剩余进程。Worker 保留有界的 v2 输出，仅在结果确认后回传。普通非零退出码属于 Shell 结果。若在交给启动器前已确定拒绝，可用已有的 v2 settled 响应承载类型化的未启动结果。中断、缺失或不可读且无法排除已执行的结果进入已有的未知状态，不得重放。启动器的原始诊断不会回传。

## 交还与回收

正常回合可以通过存活路径释放挂载。Runtime Session 进入 RELEASING，原 Worker 通过认证关闭该 Session 的工具和激活准入，并确认没有待启动、执行中、结果未知或未能确认 PID namespace 已收割的命令。Broker 还要核对原注册身份，并读原描述符对应的 cgroup，原 Worker 不是唯一直接成员或存在子组均拒绝释放。另一个回合仍在运行时也可能因此拒绝。该核验补充 Session 封门和各命令的 PID namespace 证据。所有权事务锁定绑定和 Runtime Session，比较带版本的确切句柄、代际和处于 `RELEASING` 的 owner 后，再清除该成员。执行仍活跃或未知、身份缺失或变化、发现额外成员，或者 Worker 未应答，都保留所有权。对恢复阻塞后的仅挂载交还返回 `workspace_writer_unproven`，Runtime Session 保持 active 或 RELEASING，直到取得原身份的证明。

终态清理刷新匹配的 claim，停止原文件描述符绑定的 cgroup，验证 `populated 0` 和记录的 Worker 已消失，持久化回收后生成已有回执。事务校验绑定、代际、申请和句柄后释放所有权。UNKNOWN 执行可阻塞正常清理，已 LOST 且仍有进程的 cgroup 则遵循现有的受围栏停止及恢复流程。其匹配的 JOURNAL_LOST 与 WRITERS_STOPPED 是证明原组已停止的现有替代证据。停止无法确认时保留所有权，并返回 `workspace_close_stop_unconfirmed` 或已有的类型化身份及恢复错误。同名替换组不能作为旧组已清空的证明，也不能使用旧 claim 杀掉替换组。

## 验收

- 配置未启用时沿用当前 Hosted 选择和结果契约。不符合条件的位置或不满足的先决条件无法使用隔离绑定执行，也不能回退到普通 Worker。
- 在真实 Linux 私有镜像和 cgroup v2 环境中，符合条件的选定 Hosted Runtime 执行前台 Shell，可读写自己的 Workspace。宿主、其他 Workspace 哨兵文件、宿主环境和网络均不可见。证明脱离的后代进程已经启动并关闭继承的标准流，同时证实它在命令确认返回时已退出。另验证资格失败时拒绝执行。普通非零退出、准入拒绝与执行不确定可区分。
- Harness、Broker 与 Worker 均拒绝不支持的工具、cwd、后台执行和替代执行路由。复用或过期身份无法跨能力、代际或配置变化获得准入。
- Worker 死亡并且 cgroup 还有成员时，提前交还无法清除 holder。终态前提满足时 Broker 独立证明停止。另验证 UNKNOWN 记录保持所有权，缺失或已替换的 cgroup 不能为原句柄生成回执。
