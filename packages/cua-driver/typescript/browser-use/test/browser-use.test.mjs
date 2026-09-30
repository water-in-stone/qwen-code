import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BrowserUse, BrowserUseError } from '../index.js';

function toolResult(
  structured,
  { text = '', images = [], isError = false, errorCode } = {},
) {
  return {
    text,
    images,
    structuredJson:
      structured === undefined ? undefined : JSON.stringify(structured),
    isError,
    errorCode,
    rawJson: '{}',
  };
}

function fakeDriver(handler) {
  return {
    calls: [],
    async callTool(name, argumentsJson) {
      const args = JSON.parse(argumentsJson);
      this.calls.push({ name, args });
      return handler(name, args);
    },
  };
}

function bindResult({ exact = true, active = true } = {}) {
  return toolResult({
    status: 'ok',
    mode: 'bind',
    target_id: 'target-1',
    binding_quality: exact ? 'exact' : 'heuristic',
    mutation_allowed: exact,
    native_title: 'Fixture',
    tabs: [
      {
        tab_id: 'tab-1',
        title: 'Example',
        url: 'https://example.com',
        active,
      },
    ],
  });
}

async function boundTab(driver) {
  const browser = new BrowserUse(driver, { publicSession: 'test-session' });
  const binding = await browser.bindWindow({ pid: 42, windowId: 7 });
  return { browser, binding, tab: binding.getTab('tab-1') };
}

test('discovery uses fixed tools and facade-owned session', async () => {
  const driver = fakeDriver((name) => {
    if (name === 'list_apps') {
      return toolResult({ apps: [{ pid: 42, name: 'Chrome' }] });
    }
    if (name === 'list_windows') {
      return toolResult({
        windows: [{ pid: 42, window_id: 7, title: 'Fixture' }],
      });
    }
    throw new Error(`unexpected tool ${name}`);
  });
  const browser = new BrowserUse(driver, { publicSession: 'test-session' });

  assert.deepEqual(await browser.listApps(), [{ pid: 42, name: 'Chrome' }]);
  assert.deepEqual(await browser.listWindows({ pid: 42, onScreenOnly: true }), [
    { pid: 42, window_id: 7, title: 'Fixture' },
  ]);
  assert.deepEqual(driver.calls, [
    { name: 'list_apps', args: { session: 'test-session' } },
    {
      name: 'list_windows',
      args: {
        pid: 42,
        on_screen_only: true,
        session: 'test-session',
      },
    },
  ]);
});

test('exact binding produces owned tabs and semantic observations', async () => {
  const driver = fakeDriver((name, args) => {
    if (name === 'get_browser_state' && args.pid !== undefined) {
      return bindResult();
    }
    if (name === 'get_browser_state') {
      return toolResult(
        {
          status: 'ok',
          mode: 'snapshot',
          target_id: 'target-1',
          tab_id: 'tab-1',
          page: { url: 'https://example.com', title: 'Example' },
          outline: '[1] button Example',
          refs: [
            {
              ref: 'p1:1',
              role: 'button',
              name: 'Example',
              actions: ['click'],
            },
          ],
          content_refs: [],
          snapshot: { id: 'p1', format: 'semantic_v2', complete: true },
          screenshot: {
            source: 'cdp_tab',
            scope: 'viewport',
            coordinate_space: 'viewport_css_px',
            viewport_css_width: 800,
            viewport_css_height: 600,
            pixel_to_css_scale_x: 0.5,
            pixel_to_css_scale_y: 0.5,
          },
          screenshot_width: 1600,
          screenshot_height: 1200,
          screenshot_mime_type: 'image/png',
        },
        {
          text: 'semantic snapshot',
          images: [{ mimeType: 'image/png', dataBase64: 'cG5n' }],
        },
      );
    }
    throw new Error(`unexpected tool ${name}`);
  });
  const { binding, tab } = await boundTab(driver);

  assert.equal(binding.targetId, 'target-1');
  assert.equal(binding.mutationAllowed, true);
  assert.throws(() => binding.getTab('other'), {
    code: 'browser_tab_not_found',
  });

  const observation = await tab.observe({
    query: 'Example',
    includeScreenshot: true,
  });
  assert.equal(observation.outline, '[1] button Example');
  assert.equal(observation.refs[0].ref, 'p1:1');
  assert.equal(observation.screenshot.width, 1600);
  assert.equal(observation.screenshot.coordinateSpace, 'viewport_css_px');
  assert.equal(observation.screenshot.pixelToCssScaleX, 0.5);
  assert.equal(observation.screenshot.images.length, 1);
  assert.deepEqual(driver.calls[1], {
    name: 'get_browser_state',
    args: {
      target_id: 'target-1',
      tab_id: 'tab-1',
      snapshot_format: 'semantic_v2',
      query: 'Example',
      include_screenshot: true,
      session: 'test-session',
    },
  });
});

test('binding preserves unknown active-tab evidence', async () => {
  const driver = fakeDriver(() => bindResult({ active: null }));
  const browser = new BrowserUse(driver, { publicSession: 'test-session' });
  const binding = await browser.bindWindow({ pid: 42, windowId: 7 });

  assert.equal(binding.tabs[0].active, null);
});

test('structured refusals throw even when isError is false', async () => {
  const driver = fakeDriver(() =>
    toolResult({
      status: 'refused',
      refusal: {
        code: 'browser_requires_setup',
        message: 'prepare an isolated browser',
      },
    }),
  );
  const browser = new BrowserUse(driver, { publicSession: 'test-session' });

  await assert.rejects(
    browser.bindWindow({ pid: 42, windowId: 7 }),
    (error) =>
      error instanceof BrowserUseError &&
      error.code === 'browser_requires_setup' &&
      error.details.refusal.message === 'prepare an isolated browser',
  );
});

test('SDK action projection refusals recover the Driver code from text', async () => {
  const driver = fakeDriver((name) => {
    if (name === 'get_browser_state') return bindResult();
    return toolResult(
      {
        effect: 'refused',
        route: 'dom',
        escalation: { target: 'page', reason: 'route_unavailable' },
      },
      {
        text: 'refused (browser_ref_stale): take a fresh browser snapshot',
      },
    );
  });
  const { tab } = await boundTab(driver);

  await assert.rejects(
    tab.click({ ref: 'p1:1', inputRoute: 'dom_event' }),
    (error) =>
      error instanceof BrowserUseError &&
      error.code === 'browser_ref_stale' &&
      error.details.effect === 'refused' &&
      error.details.refusal.message === 'take a fresh browser snapshot',
  );
});

test('successful actions require a structured result', async () => {
  const driver = fakeDriver((name) => {
    if (name === 'get_browser_state') return bindResult();
    return toolResult(undefined, { text: 'ok' });
  });
  const { tab } = await boundTab(driver);

  await assert.rejects(tab.navigate('https://example.com/next'), {
    code: 'invalid_browser_result',
  });
});

test('heuristic bindings remain observable but refuse mutations locally', async () => {
  const driver = fakeDriver((name, args) => {
    if (name === 'get_browser_state' && args.pid !== undefined) {
      return bindResult({ exact: false });
    }
    if (name === 'get_browser_state') {
      return toolResult({
        status: 'ok',
        mode: 'snapshot',
        refs: [],
        content_refs: [],
      });
    }
    throw new Error(`unexpected tool ${name}`);
  });
  const { tab } = await boundTab(driver);

  await tab.observe();
  await assert.rejects(tab.navigate('https://example.com/next'), {
    code: 'browser_binding_not_exact',
  });
  assert.equal(driver.calls.length, 2);
});

test('actions map to fixed tools without public target fields', async () => {
  const driver = fakeDriver((name, args) => {
    if (name === 'get_browser_state') return bindResult();
    return toolResult(
      {
        status: 'ok',
        route: args.input_route ?? 'trusted',
      },
      { text: 'ok' },
    );
  });
  const { tab } = await boundTab(driver);

  await tab.click({ ref: 'p1:1', inputRoute: 'dom_event' });
  await tab.type({ ref: 'p1:2', text: 'hello', replace: true });
  await tab.pointer({
    action: 'scroll',
    x: 10,
    y: 20,
    deltaY: 300,
  });
  const dialog = await tab.inspectDialog();

  assert.equal(dialog.present, false);
  assert.deepEqual(
    driver.calls.slice(1).map(({ name }) => name),
    ['browser_click', 'browser_type', 'browser_pointer', 'browser_dialog'],
  );
  assert.deepEqual(driver.calls[1].args, {
    target_id: 'target-1',
    tab_id: 'tab-1',
    ref: 'p1:1',
    input_route: 'dom_event',
    session: 'test-session',
  });
  assert.equal(driver.calls[4].args.action, 'inspect');
});

test('invalid synthetic pointer and observation combinations fail locally', async () => {
  const driver = fakeDriver((name) => {
    if (name === 'get_browser_state') return bindResult();
    throw new Error(`unexpected tool ${name}`);
  });
  const { tab } = await boundTab(driver);

  await assert.rejects(
    tab.pointer({
      action: 'scroll',
      x: 10,
      y: 20,
      deltaY: 100,
      inputRoute: 'dom_event',
    }),
    /requires ref/,
  );
  await assert.rejects(
    tab.observe({ continuation: 'next', query: 'Submit' }),
    /cannot be combined/,
  );
  assert.equal(driver.calls.length, 1);
});

test('isolated preparation invalidates prior handles and requires rediscovery', async () => {
  const driver = fakeDriver((name) => {
    if (name === 'get_browser_state') return bindResult();
    if (name === 'browser_prepare') {
      return toolResult({
        status: 'ok',
        prepared: true,
        prepared_pid: 99,
        action: 'launched',
        message: 'isolated browser ready',
      });
    }
    throw new Error(`unexpected tool ${name}`);
  });
  const { browser, binding } = await boundTab(driver);

  const prepared = await browser.prepareIsolated({
    pid: 42,
    profileName: 'fixture',
  });
  assert.equal(prepared.preparedPid, 99);
  assert.deepEqual(driver.calls[1].args, {
    pid: 42,
    allow_launch: true,
    profile: { mode: 'isolated_named', name: 'fixture' },
    session: 'test-session',
  });
  assert.throws(() => binding.getTab('tab-1'), {
    code: 'browser_binding_stale',
  });
});

test('transport failure invalidates the facade without retrying', async () => {
  let calls = 0;
  const driver = fakeDriver(() => {
    calls += 1;
    throw new Error('transport closed');
  });
  const browser = new BrowserUse(driver, { publicSession: 'test-session' });

  await assert.rejects(browser.listApps(), {
    code: 'browser_transport_failed',
  });
  await assert.rejects(browser.listApps(), {
    code: 'browser_session_invalid',
  });
  assert.equal(calls, 1);
});

test('pre-dispatch cancellation performs no call', async () => {
  const driver = fakeDriver(() => toolResult({ apps: [] }));
  const browser = new BrowserUse(driver, { publicSession: 'test-session' });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(browser.listApps({ signal: controller.signal }), {
    code: 'call_cancelled',
  });
  assert.equal(driver.calls.length, 0);
});

test('post-dispatch cancellation waits for the result and is reported', async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const driver = fakeDriver((name) => {
    if (name === 'get_browser_state') return bindResult();
    if (name === 'browser_navigate') return pending;
    throw new Error(`unexpected tool ${name}`);
  });
  const { tab } = await boundTab(driver);
  const controller = new AbortController();
  const navigation = tab.navigate('https://example.com/next', {
    signal: controller.signal,
  });
  controller.abort();
  resolve(toolResult({ status: 'ok' }));

  const result = await navigation;
  assert.equal(result.operation.cancellationRequested, true);
  assert.equal(result.operation.committed, true);
});

test('close waits for an active call and invalidates child handles', async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const driver = fakeDriver((name) => {
    if (name === 'get_browser_state') return bindResult();
    if (name === 'browser_navigate') return pending;
    throw new Error(`unexpected tool ${name}`);
  });
  const { browser, binding, tab } = await boundTab(driver);
  const navigation = tab.navigate('https://example.com/next');
  let closed = false;
  const closing = browser.close().then(() => {
    closed = true;
  });

  await Promise.resolve();
  assert.equal(closed, false);
  assert.throws(() => binding.getTab('tab-1'), /closed/);

  resolve(toolResult({ status: 'ok' }));
  await navigation;
  await closing;
  assert.equal(closed, true);
  await browser.close();
});

test('owned close drains calls before session and runtime teardown', async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const events = [];
  const driver = fakeDriver((name) => {
    if (name === 'get_browser_state') return bindResult();
    if (name === 'browser_navigate') return pending;
    throw new Error(`unexpected tool ${name}`);
  });
  driver.endSession = async () => events.push('endSession');
  driver.closeAsync = async () => events.push('closeAsync');
  driver.uniffiDestroy = () => events.push('destroySession');
  const owner = {
    async shutdown() {
      events.push('shutdown');
    },
    uniffiDestroy() {
      events.push('destroyOwner');
    },
  };
  const browser = new BrowserUse(driver, {
    owner,
    ownsSession: true,
    publicSession: 'test-session',
  });
  const binding = await browser.bindWindow({ pid: 42, windowId: 7 });
  const navigation = binding
    .getTab('tab-1')
    .navigate('https://example.com/next');
  const closing = browser.close();

  await Promise.resolve();
  assert.deepEqual(events, []);
  resolve(toolResult({ status: 'ok' }));
  await navigation;
  await closing;
  assert.deepEqual(events, [
    'endSession',
    'closeAsync',
    'destroySession',
    'shutdown',
    'destroyOwner',
  ]);
});

test('protected browser operations are absent from the public facade', async () => {
  const driver = fakeDriver(() => bindResult());
  const { tab } = await boundTab(driver);

  assert.equal(tab.setInputFiles, undefined);
  assert.equal(tab.download, undefined);
  assert.equal(tab.dialog, undefined);
});
