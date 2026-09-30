# Computer Use

Qwen Code includes a `computer-use` skill and a built-in restartless setup tool
that prepare the desktop runtime on first use:

```text
bundled computer-use skill
  -> computer_use_setup
  -> Qwen-managed @qwen-code/node-repl-mcp
  -> pinned @qwen-code/cua-sdk/computer-use
  -> native cua-driver accessibility backend
```

The MCP server and SDK are installed on demand into a versioned Qwen-managed
directory. They are connected to the current session through runtime-only MCP
registration.

> [!warning]
>
> Computer Use can read application UI and control mouse and keyboard input.
> Use it only in trusted environments and review MCP approvals carefully.

## Automatic setup

Node.js 22 or later and npm are required.

When no desktop relay or existing Node REPL is available, the skill calls
`computer_use_setup`. The tool installs these pinned packages:

```text
@qwen-code/node-repl-mcp@0.1.6
@qwen-code/cua-sdk@0.20.11
```

The runtime is stored under:

```text
~/.qwen/computer-use/runtimes/
```

Setup does not modify the workspace, its `node_modules`, or user MCP settings.
The installed Node REPL is connected to the active session immediately, so the
same conversation continues without restarting Qwen Code. A later session
reuses the verified runtime and reconnects it without reinstalling.

The SDK postinstall downloads and verifies the native payload for the current
platform. First use therefore requires network access unless npm and native
artifacts are already cached.

## Use

Ask Qwen Code to use `$computer-use` for the desktop task. After bootstrap, it
uses the app workflow on macOS:

1. binds the application with `computer.getApp(nameOrIdentifierOrPath)`;
2. reads `app.getState()` for compact accessibility text, followed by automatic
   incremental updates;
3. performs one or more actions using the short element IDs in that text;
4. fetches the latest state before deciding what to do next; and
5. closes the SDK client and resets the REPL only when no other persistent
   state is needed.

The driver is the only component that computes observation diffs. Model code
uses the typed SDK methods and does not dispatch arbitrary driver tool names.
The app handle tracks the current window and dialogs, keeps native element
identity internally, and delegates input to the native driver. Model code does
not choose foreground/background modes. Unconfirmed actions are not replayed.
`getState()` can open a discovered stopped app; actions never restart it.
Existing exact-window APIs remain available on Windows and Linux.

```js
const app = await computer.getApp('Microsoft Excel');
nodeRepl.write((await app.getState()).text);
// Use an element ID from the returned state.
await app.click(37);
await app.typeText('hello');
nodeRepl.write((await app.getState()).text);
```

Refresh state after opening or closing a dialog before reusing element IDs.
Each App state refresh captures the current screenshot internally. The default
return keeps it hidden; request it explicitly with
`app.getState({ includeScreenshot: true })` when the model needs the image.

## Permissions

`computer_use_setup` asks for approval before it writes product files, runs npm
lifecycle scripts, and starts the managed MCP process. The Node REPL executes
model-authored JavaScript with ordinary Node.js authority, and its calls
continue to follow Qwen Code's normal [MCP approval flow](./approval-mode.md).
There is no additional nested per-action approval layer. The SDK also enforces
native authorization.

On macOS, accessibility observation and input require Accessibility permission.
Screenshots additionally require Screen Recording permission. macOS may
attribute the grant to the terminal or IDE that launched Qwen Code. Windows and
Linux use their platform accessibility and input facilities. Restartless setup
does not change this launcher-owned identity into a signed Qwen application
identity.

## Use the computer in front of you from a remote session

When Qwen Code runs on a headless machine (a dev box, a server), the skill can
still drive the desktop you are sitting at: that computer lends its own
`node_repl` to one remote session. It works on macOS today.

Set it up once on your computer:

```bash
npx -y @qwen-code/node-repl-mcp@0.1.7 desktop-relay install
```

This installs `node_repl` and the SDK under `~/.qwen/desktop-relay` and registers
a launchd socket on `127.0.0.1:47821`. Nothing runs in the background; launchd
starts a short-lived process only when something connects.

- **From the Web Shell.** The remote daemon must run with
  `QWEN_SERVE_CLIENT_MCP_OVER_WS=1`, and the Web Shell must be a secure page
  (https, or `http://localhost` through an SSH tunnel). In a session, choose
  **Use this computer** in the sidebar footer, then **Connect this computer**.

A dialog on your computer asks you to allow every connection. An allowed session
can run code on your computer with your permissions and see and control its
screen, just like local Computer Use, until you disconnect it or it ends. macOS
asks to allow `node` under Accessibility and Screen Recording the first time.

## Troubleshooting

- If setup fails, read the `computer_use_setup` error. npm/network failures,
  native postinstall failures, and an invalid published runtime all fail
  without changing MCP settings.
- If setup reports an invalid existing runtime, remove only the versioned
  runtime directory named in the error, then retry. Setup never replaces that
  directory while another process may still be using it.
- If a user-managed Node REPL cannot import the SDK, run
  `computer_use_setup` and use `computer-use-node-repl` instead.
- After a timeout, cancellation, reset, or kernel crash, bootstrap the SDK
  client again and request fresh state.

## See also

- [Skills](./skills.md)
- [MCP servers](./mcp.md)
- [Approval Mode](./approval-mode.md)
- [Sandboxing](./sandbox.md)
