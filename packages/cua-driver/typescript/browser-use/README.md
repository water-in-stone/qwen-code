# @qwen-code/cua-sdk/browser-use

Typed Browser facade over Cua Driver's exact browser tools.

The facade owns the public session, browser target, and tab capabilities. Model
code selects semantic page refs but cannot dispatch arbitrary Driver tools or
override the session, target, or tab.

This is an SDK surface, not the backend of Qwen Code's canonical bundled
`browser-use` Skill. That Skill uses Qwen's Chrome extension and bundled Browser
Use runtime.

## Usage

```js
import { BrowserUse } from '@qwen-code/cua-sdk/browser-use';

const browser = await BrowserUse.create();
try {
  const apps = await browser.listApps();
  const windows = await browser.listWindows({ pid: apps[0].pid });
  const binding = await browser.bindWindow({
    pid: apps[0].pid,
    windowId: windows[0].window_id,
  });
  const tabInfo =
    binding.tabs.find((tab) => tab.active === true) ??
    (binding.tabs.length === 1 ? binding.tabs[0] : undefined);
  if (!tabInfo) throw new Error('select an explicit tab');
  const tab = binding.getTab(tabInfo.tabId);
  const state = await tab.observe({ includeScreenshot: true });

  const clickRef = state.refs.find((ref) => ref.actions.includes('click'));
  if (!clickRef) throw new Error('no clickable ref');
  await tab.click({ ref: clickRef.ref, inputRoute: 'dom_event' });

  const updated = await tab.observe();
  const typeRef = updated.refs.find((ref) => ref.actions.includes('type'));
  if (!typeRef) throw new Error('no editable ref');
  await tab.type({ ref: typeRef.ref, text: 'hello', replace: true });
} finally {
  await browser.close();
}
```

If binding returns `browser_requires_setup`, prepare an isolated profile,
rediscover the returned PID's windows, and bind again:

```js
const prepared = await browser.prepareIsolated({ pid });
const windows = await browser.listWindows({ pid: prepared.preparedPid });
const binding = await browser.bindWindow({
  pid: prepared.preparedPid,
  windowId: windows[0].window_id,
});
```

Every Driver refusal becomes `BrowserUseError` and preserves its `code` and
structured `details`. The facade never automatically replays a mutation or
rebinds a session-owned tab after transport failure.

Tab `active` state is `true`, `false`, or `null`. When multiple tabs have
unknown active state, select one explicitly by its current title or URL rather
than guessing from list order. Navigation and newer snapshots invalidate prior
semantic refs.

The default click route is trusted browser input. Use `inputRoute: 'dom_event'`
only when synthetic page behavior satisfies the task, and verify the result
with a fresh observation.

## Authorization Boundary

This facade adds no per-action confirmation prompts. It exposes isolated
preparation, exact binding, semantic observation, navigation, click, type,
pointer actions, and JavaScript dialog inspection under the Driver's standard
authorization profile.

Existing-profile attachment, file upload, dialog mutation, and download are
not exposed. They require a trusted host authorization boundary that the
generic Node REPL does not provide.

Use desktop Computer Use for browser chrome and native UI. Close one direct
facade before creating the other because Cua Driver admits one direct runtime
per process. Do not use desktop fallback to bypass the unavailable
existing-profile, file-transfer, download, or dialog-mutation operations.
