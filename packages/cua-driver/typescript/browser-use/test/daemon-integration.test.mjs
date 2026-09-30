/**
 * Real-browser E2E for the public Browser Use facade.
 *
 * Set BROWSER_USE_SOURCE_PID to a running Chrome, Chromium, or Edge browser.
 * The test uses that process only to select a browser product, then launches a
 * separate driver-owned isolated profile.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { BrowserUse, BrowserUseError } from '../index.js';

const sourcePid = Number(process.env.BROWSER_USE_SOURCE_PID ?? '');
const configured = Number.isInteger(sourcePid) && sourcePid > 0;

function fixturePage({ dialog = false } = {}) {
  return `<!doctype html>
<html>
  <head><title>Browser Use Fixture</title></head>
  <body>
    <h1>Browser Use Fixture</h1>
    <label for="name">Name</label>
    <input id="name" value="old">
    <button id="increment" onclick="document.querySelector('#count').textContent='Count 1'">Increment</button>
    <p id="count">Count 0</p>
    <p id="typed"></p>
    <script>
      document.querySelector('#name').addEventListener('input', (event) => {
        document.querySelector('#typed').textContent = 'Typed ' + event.target.value;
      });
      ${dialog ? "setTimeout(() => alert('fixture dialog'), 250);" : ''}
    </script>
  </body>
</html>`;
}

async function waitForWindow(browser, pid) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const windows = await browser.listWindows({ pid, onScreenOnly: true });
    const exact = windows.find(
      (window) =>
        window.is_on_screen === true &&
        typeof window.title === 'string' &&
        window.title.length > 0 &&
        Number(window.bounds?.width) >= 400 &&
        Number(window.bounds?.height) >= 300,
    );
    if (exact) return exact;
    await delay(250);
  }
  throw new Error(`isolated browser ${pid} did not expose a bindable window`);
}

function currentFrontmostApp() {
  return execFileSync(
    'osascript',
    [
      '-e',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ],
    { encoding: 'utf8' },
  ).trim();
}

function currentPointer() {
  const output = execFileSync(
    'swift',
    [
      '-e',
      'import CoreGraphics; let point = CGEvent(source: nil)!.location; print("\\(point.x),\\(point.y)")',
    ],
    { encoding: 'utf8' },
  ).trim();
  return output.split(',').map(Number);
}

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return;
      throw error;
    }
    await delay(100);
  }
  throw new Error(`driver-owned browser ${pid} remained alive after close`);
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test(
  'typed facade drives an isolated real browser without raw dispatch',
  { skip: !configured && 'set BROWSER_USE_SOURCE_PID to run' },
  async () => {
    const server = http.createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fixturePage({ dialog: request.url === '/dialog' }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    let browser;
    let preparedPid;
    try {
      browser = await BrowserUse.create({
        session: `browser-use-e2e-${process.pid}`,
      });
      const prepared = await browser.prepareIsolated({
        pid: sourcePid,
        profileName: `e2e-${randomUUID().slice(0, 8)}`,
      });
      preparedPid = prepared.preparedPid;
      assert.equal(prepared.prepared, true);
      assert.ok(Number.isInteger(preparedPid) && preparedPid > 0);
      assert.equal(prepared.sideEffects?.copied_profile_data, false);
      assert.equal(prepared.sideEffects?.changed_preferences, false);
      assert.equal(prepared.sideEffects?.foregrounded_window, false);
      assert.equal(prepared.sideEffects?.injected_global_input, false);

      const window = await waitForWindow(browser, preparedPid);
      const binding = await browser.bindWindow({
        pid: preparedPid,
        windowId: window.window_id,
      });
      assert.equal(binding.bindingQuality, 'exact');
      assert.equal(binding.mutationAllowed, true);

      const activeTabs = binding.tabs.filter((tab) => tab.active === true);
      const tabInfo =
        activeTabs.length === 1
          ? activeTabs[0]
          : binding.tabs.length === 1
            ? binding.tabs[0]
            : undefined;
      assert.ok(tabInfo, 'the isolated browser must expose one explicit tab');
      const tab = binding.getTab(tabInfo.tabId);

      const desktopBefore =
        process.platform === 'darwin'
          ? {
              frontmost: currentFrontmostApp(),
              pointer: currentPointer(),
            }
          : undefined;

      await tab.navigate(`${baseUrl}/fixture`);
      let state = await tab.observe({ includeScreenshot: true });
      assert.match(state.outline, /Browser Use Fixture/u);
      assert.equal(state.screenshot?.mimeType, 'image/png');
      assert.equal(state.screenshot?.coordinateSpace, 'viewport_css_px');
      assert.equal(state.screenshot?.images.length, 1);

      const increment = state.refs.find(
        (ref) => ref.name === 'Increment' && ref.actions.includes('click'),
      );
      assert.ok(increment);

      await tab.click({ ref: increment.ref, inputRoute: 'dom_event' });
      state = await tab.observe({ query: 'Count 1' });
      assert.match(state.outline, /Count 1/u);

      const staleRef = increment.ref;
      await tab.navigate(`${baseUrl}/second`);
      state = await tab.observe();
      await assert.rejects(
        tab.click({ ref: staleRef, inputRoute: 'dom_event' }),
        (error) =>
          error instanceof BrowserUseError &&
          error.code === 'browser_ref_stale',
      );

      const freshInput = state.refs.find(
        (ref) => ref.name === 'Name' && ref.actions.includes('type'),
      );
      assert.ok(freshInput);
      await tab.type({
        ref: freshInput.ref,
        text: 'typed value',
        replace: true,
      });
      state = await tab.observe({ query: 'Typed typed value' });
      assert.match(state.outline, /Typed typed value/u);

      if (desktopBefore) {
        assert.equal(currentFrontmostApp(), desktopBefore.frontmost);
        const pointerAfter = currentPointer();
        assert.ok(Math.abs(pointerAfter[0] - desktopBefore.pointer[0]) < 1);
        assert.ok(Math.abs(pointerAfter[1] - desktopBefore.pointer[1]) < 1);
      }

      assert.equal((await tab.inspectDialog()).present, false);
      await tab.navigate(`${baseUrl}/dialog`);
      let dialog;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        dialog = await tab.inspectDialog();
        if (dialog.present) break;
        await delay(100);
      }
      assert.equal(dialog?.present, true);
      assert.equal(dialog?.kind, 'alert');
    } finally {
      try {
        await browser?.close();
      } finally {
        await closeServer(server);
      }
    }
    await waitForExit(preparedPid);
  },
);
