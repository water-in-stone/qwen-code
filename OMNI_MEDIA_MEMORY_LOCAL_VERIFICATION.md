# Omni 媒体 Memory 本地验证指南

本文用于验证 `omni_recall_media_memory` 的 S5a 最小媒体 Memory 能力：

- Session A 成功识别媒体后，识别事实会写入当前项目；
- Session B 可以按绝对路径或完整 SHA-256 召回同一条记录；
- 相同字节只保存一条内容记录；
- 不同项目之间的 Memory 相互隔离；
- Tool 的召回结果不暴露持久化的本地路径。

## 1. 验证边界

完整验证分为两层：

1. **自动化回归**：不需要真实模型或网络，覆盖 store、并发、损坏恢复、写入边界、Tool schema、权限与隐私等行为。
2. **真实跨 Session E2E**：需要 DashScope-compatible Provider、静态 API Key、显式 `baseUrl`、支持目标媒体模态的模型，以及 `ffmpeg` / `ffprobe`。

真实 E2E 必须使用两个独立 CLI 进程。仅在同一进程里创建两个 service 实例，不能证明跨 Session 持久化成立。

## 2. 前置条件

### 2.1 安装依赖

在仓库根目录执行：

```bash
node --version
ffmpeg -version
ffprobe -version
jq --version
npm install
```

要求：

- Node.js `>= 22`；
- `ffmpeg` 和 `ffprobe` 都在 `PATH` 中；
- `jq` 用于检查本地 store（不影响功能运行）；
- 当前 Qwen Code 配置使用 DashScope-compatible OpenAI Provider；
- Provider 配置包含可用的静态 API Key 和显式 `baseUrl`；
- 使用支持待验证媒体模态的模型，并在 `modelProviders` 对应条目中显式配置 `generationConfig.modalities`；图片验证至少需要 `"image": true`，避免自动能力识别与本地配置不一致；
- 不使用 Qwen OAuth，因为 Omni 临时上传通道不接受 OAuth placeholder credential。

macOS 缺少 ffmpeg 或 jq 时可以执行：

```bash
brew install ffmpeg
brew install jq
```

Provider 配置可参考 [`docs/users/configuration/auth.md`](docs/users/configuration/auth.md)。不要把真实 API Key 写入仓库或本文创建的临时项目。

Session A 前必须运行下面的硬预检。它只输出路由和布尔检查结果，不输出 API Key
的值；命令必须以退出码 `0` 结束，且五个检查都为 `true`：

```bash
QWEN_SETTINGS="${QWEN_HOME:-$HOME/.qwen}/settings.json"
jq -e '
  . as $settings
  | .model.name as $selectedModel
  | ([
      .modelProviders[]?[]?
      | select(.id == $selectedModel)
    ][0]) as $route
  | {
      model: $selectedModel,
      baseUrl: ($route.baseUrl // null),
      envKey: ($route.envKey // null),
      modalities: ($route.generationConfig.modalities // {}),
      checks: {
        routeMatched: ($route != null),
        explicitBaseUrl: (($route.baseUrl // "") | length > 0),
        dashScopeCompatible: (
          (($route.baseUrl // "") | test(
            "^https://([^.:/]+[.])*(dashscope[.]aliyuncs[.]com|dashscope-intl[.]aliyuncs[.]com|dashscope-us[.]aliyuncs[.]com)([:/]|$)";
            "i"
          ))
          or
          (($route.baseUrl // "") | test(
            "^https://token-plan[.][^.]+[.]maas[.]aliyuncs[.]com([:/]|$)";
            "i"
          ))
          or
          (($route.baseUrl // "") | test(
            "^https://[^/:]+[.](alibaba-inc[.]com|aliyun-inc[.]com)([:/]|$)";
            "i"
          ))
          or (
            (env.DASHSCOPE_PROXY_BASE_URL // "") != ""
            and (($route.baseUrl // "") == env.DASHSCOPE_PROXY_BASE_URL)
          )
        ),
        staticApiKey: (
          ($route.envKey // "") != ""
          and (
            ($settings.env[$route.envKey] // env[$route.envKey] // "")
            | length > 0
          )
        ),
        imageModality: (
          ($route.generationConfig.modalities.image // false) == true
        )
      }
    }
  | . as $report
  | $report,
    (if ([$report.checks[]] | all)
     then empty
     else error("Omni media-memory prerequisites failed; fix the false checks before Session A")
     end)
' "$QWEN_SETTINGS"
```

当前模型必须能匹配到一个 DashScope-compatible `baseUrl`。如果只配置了 MiniMax、
DeepSeek 等第三方 endpoint，预检中的 `dashScopeCompatible` 会是 `false`；即使设置
`QWEN_CODE_ENABLE_OMNI=1`，上传式 Omni 投递也不会启用，Session A 不会写入媒体
Memory。不要继续执行 3.1；先按
[`docs/users/configuration/auth.md`](docs/users/configuration/auth.md) 配置 DashScope
Provider，并在目标模型的 `generationConfig.modalities` 中显式设置
`"image": true`。

### 2.2 准备隔离的测试项目

下面的命令必须从本仓库根目录执行：

```bash
export QWEN_OMNI_REPO="$(pwd -P)"
QWEN_OMNI_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/qwen-omni-memory.XXXXXX")"
cd "$QWEN_OMNI_PROJECT"
export QWEN_OMNI_PROJECT="$(pwd -P)"
export QWEN_OMNI_IMAGE="$QWEN_OMNI_PROJECT/sample.png"

cp "$QWEN_OMNI_REPO/packages/chrome-extension/public/icons/icon-128.png" \
  "$QWEN_OMNI_IMAGE"

pwd -P
```

使用临时项目有两个目的：避免污染本仓库的 `.qwen/omni`，并让项目隔离检查更直观。

这里必须用 `pwd -P` 保存物理路径。macOS 的 `/var` 通常是 `/private/var` 的 symlink；如果 CLI 的 workspace 是 `/private/var/...`，却把 `/var/...` 作为 `file_path` 传给 recall Tool，安全边界会把这个词法上位于 workspace 外的路径拒绝为 `outside_workspace`。

### 2.3 确认 workspace trust

首次从仓库根目录启动本地源码，并用 `QWEN_WORKING_DIR` 指定要验证的 workspace：

```bash
cd "$QWEN_OMNI_REPO"
QWEN_WORKING_DIR="$QWEN_OMNI_PROJECT" \
QWEN_CODE_ENABLE_OMNI=1 \
  npm run dev
```

如果出现 Folder Trust 对话框，选择 **Trust folder**。然后退出 CLI，再开始下面的 Session A。Folder Trust 功能未开启时，CLI 默认按 trusted workspace 运行。

`QWEN_CODE_ENABLE_OMNI=1` 等价于设置 `omni.enabled=true`，只对当前命令生效，适合本地验证。不要使用 `--bare`，因为 bare mode 不注册 recall Tool。

`npm run dev` 本身会调用 `node scripts/dev.js`；应从仓库根目录使用 npm script，而不是从临时 workspace 直接执行 npm。`QWEN_WORKING_DIR` 只改变 CLI 的 workspace，不改变源码和依赖解析位置。命令进入 TUI 后会持续等待输入，这是正常的交互模式，不是卡死；看到输入框后继续输入提示，结束时使用 `/quit`。

如果只想做一次非交互冒烟并让进程自动退出，可以传入 prompt 和结构化输出格式：

```bash
cd "$QWEN_OMNI_REPO"
QWEN_WORKING_DIR="$QWEN_OMNI_PROJECT" \
QWEN_CODE_ENABLE_OMNI=1 \
  npm run dev -- \
    --prompt '请处理 @./sample.png 并告诉我图片尺寸。' \
    --output-format stream-json
```

## 3. 主流程：跨 Session 写入与召回

### 3.1 Session A：识别并写入 Memory

从仓库根目录启动第一个独立进程：

```bash
cd "$QWEN_OMNI_REPO"
QWEN_WORKING_DIR="$QWEN_OMNI_PROJECT" \
QWEN_CODE_ENABLE_OMNI=1 \
  npm run dev
```

输入：

```text
请处理 @./sample.png 并告诉我识别出的媒体类型和图片尺寸。
```

等待本轮完整结束后，用 `/quit` 或 `Ctrl-D` 退出 Session A。

成功判据：

- 媒体完成识别和正常投递；
- `$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json` 已生成；
- JSON 顶层 `version` 为 `1`；
- `entries` 只有一条，模态为 `image`，MIME 为 `image/png`。

查看脱敏后的 store 摘要：

```bash
jq '{
  version,
  entryCount: (.entries | length),
  entries: [
    .entries[] | {
      sha256,
      modality,
      detectedMimeType,
      sizeBytes,
      metadata,
      tokenEstimate,
      firstRecognizedAt,
      lastRecognizedAt,
      observedPathCount: (.observedLocalPaths | length)
    }
  ]
}' "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json"
```

对比当前文件的内容哈希：

```bash
shasum -a 256 "$QWEN_OMNI_IMAGE"
jq -r '.entries | keys[]' \
  "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json"
```

Linux 如果没有 `shasum`，使用 `sha256sum`。两条命令输出的 64 位 SHA-256 应一致。

> Memory 写入发生在内容 hash 完成后、上传缓存查询和网络上传之前。若上传阶段失败但前面的识别已经完成，store 仍可能已经写入；完整 E2E 仍应以媒体投递和后续召回都成功为准。

### 3.2 Session B：按路径召回

重新启动第二个独立进程：

```bash
cd "$QWEN_OMNI_REPO"
QWEN_WORKING_DIR="$QWEN_OMNI_PROJECT" \
QWEN_CODE_ENABLE_OMNI=1 \
  npm run dev
```

输入下面的提示，把路径替换成 `echo "$QWEN_OMNI_IMAGE"` 的实际输出：

```text
必须调用 omni_recall_media_memory 工具；只传 file_path，值为“这里填写 sample.png 的绝对路径”。请列出工具返回的 status、sha256、modality、detectedMimeType、sizeBytes、metadata、tokenEstimate、firstRecognizedAt 和 lastRecognizedAt。
```

成功判据：

- 确实调用了 `omni_recall_media_memory`；
- Tool 返回 `status: "hit"`；
- SHA-256 与 Session A 的 store key 一致；
- `modality` 为 `image`，`detectedMimeType` 为 `image/png`；
- 召回结果的 `entry` 不包含 `observedLocalPaths` 或其他真实路径字段。

注意：ToolCall 的输入本身包含用户提交的 `file_path`，这是预期行为。隐私断言只针对 ToolResult/function response，不能对包含调用参数的整段会话日志直接搜索绝对路径。

### 3.3 Session B：按 SHA-256 召回

在同一个 Session B 中，从 store 复制完整 SHA-256 后输入：

```text
必须调用 omni_recall_media_memory 工具；只传 sha256，值为“这里填写完整的 64 位 SHA-256”。请原样列出工具返回的字段。
```

成功判据：

- 返回 `status: "hit"`；
- 返回内容与路径查询对应同一条记录；
- hash 查询不需要读取原媒体文件；
- 返回结果不包含任何本地路径。

## 4. 核心验收场景

### 4.1 相同内容去重

复制同一份字节到第二个 workspace 路径：

```bash
cp "$QWEN_OMNI_IMAGE" "$QWEN_OMNI_PROJECT/sample-copy.png"
```

重新进入 Qwen Code，并处理 `@./sample-copy.png`。完成后执行：

```bash
jq '.entries | length' \
  "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json"

jq '[.entries[].observedLocalPaths | length]' \
  "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json"
```

成功判据：

- `entries | length` 仍为 `1`；
- 同一 entry 的内部 occurrence 数量变为 `2`；
- 两个路径以及完整 SHA-256 都能召回同一条内容记录。

### 4.2 项目隔离

创建第二个项目，但不要在该项目中识别图片：

```bash
export QWEN_OMNI_OTHER_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/qwen-omni-memory-other.XXXXXX")"
cd "$QWEN_OMNI_OTHER_PROJECT"
export QWEN_OMNI_OTHER_PROJECT="$(pwd -P)"
cd "$QWEN_OMNI_REPO"
QWEN_WORKING_DIR="$QWEN_OMNI_OTHER_PROJECT" \
QWEN_CODE_ENABLE_OMNI=1 \
  npm run dev
```

如果出现 trust 对话框，信任这个临时目录。随后要求模型按第一个项目的完整 SHA-256 调用 recall Tool。

成功判据：

- 返回 `status: "miss"` 和 `reason: "not_recognized"`；
- 第二个项目不会读取第一个项目的 store；
- 只有在第二个项目自己的 Omni 管线识别相同字节后，才会在该项目命中。

### 4.3 同一路径内容变化

回到第一个项目，用另一张有效图片覆盖原路径，然后查询同一路径：

```bash
cp "$QWEN_OMNI_REPO/packages/chrome-extension/public/icons/icon-48.png" \
  "$QWEN_OMNI_IMAGE"
```

在尚未重新识别新内容时，按 `file_path` 调用 recall Tool。

成功判据：

- 返回 `status: "miss"` 和 `reason: "not_recognized"`；
- 不会因为路径相同而返回旧字节的 metadata。

再通过 `@./sample.png` 识别新内容，然后检查 store：

```bash
jq '.entries | length' \
  "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json"
```

此时应有 `2` 条 SHA-256 entry，按路径召回应命中新内容记录。

### 4.4 功能门禁

退出所有启用了 Omni 的进程，然后不带环境变量重新启动：

```bash
cd "$QWEN_OMNI_REPO"
QWEN_WORKING_DIR="$QWEN_OMNI_PROJECT" npm run dev
```

要求模型调用 `omni_recall_media_memory`。

成功判据：

- 当用户配置中 `omni.enabled` 也是 `false` 时，该 Tool 不会注册；
- untrusted workspace 或 `--bare` 模式下同样不注册；
- 重新以 `QWEN_CODE_ENABLE_OMNI=1` 启动 trusted、非 bare session 后，Tool 恢复可用。

### 4.5 安全失败语义（可选）

可以进一步验证：

- 查询 workspace 外的绝对路径，期望 `outside_workspace`；
- 查询指向 workspace 外部的 symlink，期望 `outside_workspace`；
- 查询被 `.qwenignore` 排除的文件，期望 `file_unavailable`；
- 查询超过 Omni byte cap 的文件，期望 `file_too_large`；
- 备份后故意破坏 `media-memory.json`，期望 `store_unavailable`，且损坏文件不会被空 store 覆盖。

破坏 store 前务必备份，验证后原样恢复：

```bash
cp "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json" \
  "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json.backup"

printf '{"version":1' > \
  "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json"

# 完成 store_unavailable 查询后立即恢复
mv "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json.backup" \
  "$QWEN_OMNI_PROJECT/.qwen/omni/media-memory.json"
```

## 5. 无需联网的自动化回归

先执行开发启动器和 `@path` 解析测试，再进入 `packages/core` 执行 Core 的相关测试：

```bash
cd "$QWEN_OMNI_REPO"
npx vitest run scripts/tests/dev.test.js

cd "$QWEN_OMNI_REPO/packages/cli"
npx vitest run src/ui/hooks/atCommandProcessor.test.ts

cd "$QWEN_OMNI_REPO/packages/core"
npx vitest run \
  src/services/media-memory/media-memory-service.test.ts \
  src/omni/recognition.test.ts \
  src/omni/index.test.ts \
  src/tools/omni-recall-media-memory.test.ts \
  src/config/config.test.ts \
  src/core/coreToolScheduler.test.ts \
  src/permissions/permission-manager.test.ts \
  src/permissions/autoMode.test.ts \
  src/services/loopDetectionService.test.ts
```

然后执行构建和类型检查：

```bash
cd "$QWEN_OMNI_REPO"
npm run build
npm run build --workspace @qwen-code/acp-bridge
npm run typecheck
npm run bundle
git diff --check
```

当前根级 build 不会稳定刷新 `packages/acp-bridge/dist` 的 project-reference 声明，因此在 typecheck 前显式补建该 workspace。否则可能出现大量 `Cannot find module '@qwen-code/acp-bridge/…'` 和由此派生的 `implicit any`，这不代表 Omni 代码本身存在类型错误。

自动化测试通过只能证明受控输入下的实现行为；不能代替真实 DashScope Provider、上传凭据、workspace trust 和两个独立 CLI 进程组成的跨 Session E2E。

## 6. 常见问题

### 启动时报缺少 ffmpeg 或 ffprobe

确认两个程序都能从启动 Qwen Code 的同一个 shell 中解析：

```bash
command -v ffmpeg
command -v ffprobe
```

### Session A 没有生成 `media-memory.json`

依次确认：

1. 启动命令带有 `QWEN_CODE_ENABLE_OMNI=1`，或用户配置中 `omni.enabled=true`；
2. workspace 是 trusted；
3. 没有使用 `--bare`；
4. Provider 是 DashScope-compatible，并配置了静态 API Key 与显式 `baseUrl`；
5. 当前 model ID 能匹配该 Provider，并已显式声明待测媒体的 `generationConfig.modalities`；
6. 输入确实通过 `@./sample.png` 进入 Omni 媒体管线；
7. 文件识别、token guard 和 SHA-256 计算没有提前失败。

先重新执行 2.1 的硬预检；任意一项为 `false` 都不要进入 Session A。普通
`read_file` 或 inline 图片路径也能让模型正确回答图片尺寸，但它们不会调用
`processMediaForOmniDelivery()`，因此“模型识图成功”本身不代表 Memory 已写入。

如果模型回复中出现 `Unsupported image file`，说明媒体在进入 Omni 管线前已被能力门禁降级。对于自定义 model ID，在对应 Provider 条目中补充：

```json
{
  "generationConfig": {
    "modalities": {
      "image": true
    }
  }
}
```

### 本地 endpoint 请求超时

如果 `baseUrl` 指向 `127.0.0.1` 或 `localhost`，但 shell 配置了 HTTP(S) 代理，请确保 localhost 绕过代理：

```bash
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
export no_proxy="$NO_PROXY"
```

若仍然超时，用 `lsof -nP -iTCP` 确认 CLI 连接的是目标 endpoint，而不是本机代理端口。不要为了排障打印完整环境变量或 API Key。

### Tool 不可用

Tool 仅在 `Omni enabled + trusted workspace + 非 bare mode` 三个条件同时成立时注册。修改这些启动条件后要重新启动 CLI。

### 路径查询返回 miss

路径查询会重新计算当前文件的完整 SHA-256。若文件在 Session A 后被修改，即使路径相同也不会返回旧 metadata；这是预期的防陈旧结果行为。

如果返回 `outside_workspace`，先比较 `pwd -P` 与提交给 Tool 的路径前缀。macOS 上不要混用 `/var/...` 和 `/private/var/...`；重新按照 2.2 节用物理路径设置 `QWEN_OMNI_PROJECT` 和 `QWEN_OMNI_IMAGE`。

### hash 查询命中但路径查询失败

hash 查询只访问当前项目的 store；路径查询还会检查 workspace 边界、`.qwenignore`、文件类型、大小、symlink 和读取期间的文件稳定性。先确认该文件仍是 workspace 内未被忽略的普通文件。

## 7. 清理

结束所有测试进程后，先确认变量仍指向本次 `mktemp -d` 创建的具体目录：

```bash
printf 'primary: %s\n' "$QWEN_OMNI_PROJECT"
printf 'other:   %s\n' "${QWEN_OMNI_OTHER_PROJECT:-<not-created>}"
```

确认输出无误后再删除：

```bash
rm -rf -- "$QWEN_OMNI_PROJECT"
if [[ -n "${QWEN_OMNI_OTHER_PROJECT:-}" ]]; then
  rm -rf -- "$QWEN_OMNI_OTHER_PROJECT"
fi
```

Folder Trust 开启时，这两个已删除路径可能仍保留在 `~/.qwen/trustedFolders.json`，可按需手工移除对应条目。
