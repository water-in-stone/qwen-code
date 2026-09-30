import type {
  BrowserBinding,
  BrowserTab,
  BrowserUse,
  BrowserUseError,
} from '../index.js';

export async function exerciseBrowserUseTypes(
  browser: BrowserUse,
  signal: AbortSignal,
): Promise<void> {
  const apps = await browser.listApps({ signal });
  const windows = await browser.listWindows({
    pid: apps[0]?.pid,
    onScreenOnly: true,
    signal,
  });
  const binding: BrowserBinding = await browser.bindWindow({
    pid: apps[0]?.pid ?? 42,
    windowId: windows[0]?.window_id ?? 7,
    signal,
  });
  const tab: BrowserTab = binding.getTab(binding.tabs[0]?.tabId ?? 'tab');
  const state = await tab.observe({
    query: 'Submit',
    includeScreenshot: true,
    signal,
  });
  await tab.click({ ref: state.refs[0]?.ref ?? 'p1:1', signal });
  await tab.click({ x: 10, y: 20, inputRoute: 'trusted', signal });
  await tab.type({
    ref: 'p1:2',
    text: 'hello',
    replace: true,
    signal,
  });
  await tab.pointer({
    action: 'scroll',
    ref: 'p1:3',
    deltaY: 300,
    signal,
  });
  await tab.pointer({
    action: 'drag',
    x: 10,
    y: 20,
    toX: 30,
    toY: 40,
    signal,
  });
  await tab.pointer({
    action: 'drag',
    ref: 'p1:3',
    destinationRef: 'p1:4',
    inputRoute: 'dom_event',
    signal,
  });
  await tab.inspectDialog({ signal });
  await tab.navigate('https://example.com', { signal });
  await browser.prepareIsolated({ pid: 42, profileName: 'task', signal });

  // @ts-expect-error session is owned by BrowserUse
  await browser.bindWindow({ pid: 42, windowId: 7, session: 'raw' });
  // @ts-expect-error targetId is owned by BrowserBinding
  await tab.click({ ref: 'p1:1', targetId: 'raw' });
  // @ts-expect-error coordinate DOM events require a semantic ref
  await tab.click({ x: 10, y: 20, inputRoute: 'dom_event' });
  // @ts-expect-error synthetic pointer actions require a semantic ref
  await tab.pointer({
    action: 'scroll',
    x: 10,
    y: 20,
    deltaY: 100,
    inputRoute: 'dom_event',
  });
  // @ts-expect-error synthetic drag requires a semantic destination ref
  await tab.pointer({
    action: 'drag',
    ref: 'p1:3',
    toX: 30,
    toY: 40,
    inputRoute: 'dom_event',
  });
  // @ts-expect-error protected file transfer is not exposed
  await tab.setInputFiles({ ref: 'p1:4', files: ['/tmp/file'] });
  // @ts-expect-error protected download is not exposed
  await tab.download({ ref: 'p1:5', destinationRoot: '/tmp' });
  // @ts-expect-error dialog mutation is not exposed
  await tab.dialog({ action: 'accept', dialogId: 'dialog-1' });

  const error = null as BrowserUseError | null;
  error?.code;
}
