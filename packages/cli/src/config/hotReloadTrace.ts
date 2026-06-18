/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Storage } from '@qwen-code/qwen-code-core';

/**
 * Session-independent diagnostic trace for the settings hot-reload chain
 * (SettingsWatcher → handleChange → registerMcpHotReload → reinitializeMcpServers).
 *
 * Unlike `createDebugLogger(...).debug`, which only writes once a debug session
 * has been registered (`setDebugLogSession` in the Config constructor), this
 * appends straight to a dedicated file gated ONLY on `QWEN_DEBUG_LOG_FILE`. That
 * makes the chain observable even for events that fire before the session is set
 * (e.g. `startWatching()` runs before `loadCliConfig` builds the Config).
 *
 * Output file: `<globalDebugDir>/hot-reload.log`, i.e. by default
 * `~/.qwen/debug/hot-reload.log` (or `$QWEN_HOME/debug` / `$QWEN_RUNTIME_DIR/debug`
 * when those are set).
 *
 * TODO(hot-reload): remove this direct-write trace before merge — it is a
 * debugging aid, not production telemetry.
 */
export function hotReloadTrace(tag: string, message: string): void {
  const value = process.env['QWEN_DEBUG_LOG_FILE'];
  if (
    !value ||
    ['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase())
  ) {
    return;
  }
  try {
    const dir = Storage.getGlobalDebugDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'hot-reload.log'),
      `${new Date().toISOString()} [${tag}] ${message}\n`,
    );
  } catch {
    // Best-effort diagnostics; never throw from the watcher hot path.
  }
}
