# MCP Runtime Hot Reload Design: Settings-Driven Incremental Reconnection (Issue #3696 Sub-task 3)

> Note: the original scope of sub-task 3 was runtime reconnection for "MCP/LSP". This MR implements **MCP** only. LSP is kept as a short Part C summary + TODO and is left for a later MR.

## Context

Issue #3696 is the umbrella tracking issue for the hot-reload system. Sub-task 1 (detecting settings file changes through `SettingsWatcher`) has been merged, but it still has **no subscribers**: `gemini.tsx:784` starts the watcher, while the [Sub-task 1 design](./settings-change-detection.md) explicitly leaves listener wiring to "sub-tasks 2-6". Today, when users add, remove, or edit an MCP server in `settings.json` (or install an extension), they must restart the whole session for the change to take effect, losing the conversation context in the process.

This MR focuses on **MCP** and delivers: (a) the ability to push reloaded settings into a running `Config`; and (b) MCP auto-reconnection driven by `SettingsWatcher`. Runtime reconnection for LSP also belongs to this sub-task, but **this MR does not implement it**. Part C only keeps a short summary + TODO for a later MR.

### Key Finding

What we need is: after a user edits configuration, connect / disconnect / reconnect the affected MCP servers **without restarting the session**. The good news is that the core logic for "only process what changed" already exists in the codebase. We do not need to rewrite it; we only need to wire it up.

Its behavior is straightforward: it reconciles the **server list currently desired by configuration** against the **servers currently connected**, then only touches the entries that differ:

- Added in config -> connect it.
- Removed from config -> disconnect it.
- Changed config (different command / address / etc.) -> disconnect the old connection, then reconnect with the new config.
- Unchanged -> leave it alone; preserve the connection and the tools it already registered.

"Changed or not" is determined by computing a fingerprint for each server (`connectionIdOf(name, config)`: same config means same fingerprint). This reconciliation logic already exists in both runtime modes:

- **Shared pool mode** (`runDiscoverAllMcpToolsViaPool`, `mcp-client-manager.ts:1461`): in daemon mode, multiple sessions in the same workspace **share** the same connection for each server (managed by `McpTransportPool` and released through reference counts).
- **Single-session mode** (`discoverAllMcpToolsIncremental`, `:2013`): fallback when there is no shared pool. Each session owns its own connections. When a shared pool exists, this path delegates directly to shared pool mode.

In other words, the "only reconnect the changed servers" capability already exists. **The only missing pieces are feeding it the new configuration and deciding when to trigger it.** The lower-level operations it relies on also already exist; we only orchestrate them, not rewrite them:

- **Connect / disconnect one server**: `McpClientManager.{discoverMcpToolsForServer, disconnectServer, addRuntimeMcpServer (no-op when the config is identical), removeRuntimeMcpServer}`.
- **Register / unregister a server's tools and prompts**: `ToolRegistry.{disconnectServer, disableMcpServer, discoverToolsForServer, removeMcpToolsByServer}`, `PromptRegistry.removePromptsByServer`.

This reconciliation logic reads the desired server list from `getMcpServers()`. Why does it currently ignore edits to `settings.json`? There is only one reason: **`Config` takes a fixed snapshot of `mcpServers` at startup**, and calling `addMcpServers()` after startup throws (`config.ts:3200`). In other words, there is currently no entry point for updating this settings-derived config while the session is running. Adding that entry point is the core of Part A.

### Decisions

- **Scope**: this MR only handles **MCP**: core primitives **plus settings-triggered automation**. LSP also belongs to this sub-task, but **is not implemented in this MR**; only a short summary + TODO remains in Part C for the next MR.
- **MCP strategy**: incremental diff (reuse the existing fingerprint-based reconciliation; **do not** use the full-clear `restartMcpServers()` path).
- **Admission alignment**: the shared pool path must block on pending approval **the same way as the single-session path**. The current pool path misses `isMcpServerPendingApproval`; this MR fixes that so hot reload cannot connect a gated server before user approval (see Part A, item 4). This is a design decision, not an option.

### Additional Notes

> **1. `setMcpServers()` receives the complete merged configuration, not raw settings.json and not connection instances.**
> MCP servers can come from several sources (user settings, project `.mcp.json`, workspace/system settings, `--mcp-config` / session). These sources must first be merged by priority through `assembleMcpServers(...)` into a complete map, and that complete map is what gets passed in. Using raw settings.json directly would drop higher-priority sources. This map is pure configuration: passing it in does not connect anything or start any process. It only replaces the settings layer; extension-contributed and runtime layers are still overlaid by `getMcpServers()` as before.
>
> **2. Connect / disconnect is handled by incremental reconciliation. Only changed entries should move; do not restart everything.**
> `setMcpServers` only replaces the config snapshot. The actual connect / disconnect work is performed by the incremental reconciliation triggered by `reinitializeMcpServers()`: added servers connect, removed servers disconnect, changed servers reconnect, and **unchanged connections stay intact**. Therefore, do **not** use `restartMcpServers()`: it disconnects and reconnects everything and creates a temporary window with zero MCP tools.

---

## Design

Overall idea: **Part B in the CLI layer decides "when to trigger", while Part A in the Core layer decides "how to update + reconcile"**. The diagram below shows the full data flow from a settings change on disk to effective connections (`[CLI]` = Part B, `[Core]` = Part A, `[sub-task 1]` = the already-merged watcher):

```text
1. User edits .qwen/settings.json (adds/removes/edits mcpServers, or mcp.excluded / mcp.allowed)
       |
       v
2. [sub-task 1] SettingsWatcher detects the file change
       |   - 300ms debounce: coalesces consecutive saves
       |   - Whole-file semantic diff: notify only when content really changed
       |     (self-writes / formatting-only changes do not notify)
       v
3. [CLI · Part B] Callback registered by registerMcpHotReload fires
       |     (any settings change reaches this callback)
       |
       |- a. assembleMcpServers(settings.merged.mcpServers, cwd, topTier)
       |        -> merge by priority into complete server map next
       |           (including .mcp.json / --mcp-config / session)
       |- b. Recompute connection admission lists nextGating = { excluded, allowed, pending }
       `- c. gate: both mcpServersEqual(old, next) and mcpGatingEqual(old, nextGating)
                are "unchanged" -> return early
       |        (continue only if either mcpServers or MCP admission changed)
       v
4. [CLI -> Core] Push connection admission lists into config before reconcile:
       config.setExcludedMcpServers / setAllowedMcpServers / setPendingMcpServers
       |
       v
5. [Core · Part A] config.reinitializeMcpServers(next)
       |   (outer "reconcile in progress" guard avoids races with /reload)
       |- a. setMcpServers(next): replace settings-layer snapshot
       |     (extension / runtime layers are untouched)
       `- b. discoverAllMcpToolsIncremental: reconciliation-style incremental reconcile
                - Compute connectionIdOf fingerprint for each server and compare
                  desired vs online
                - Added -> connect; removed -> disconnect + remove tools/prompts;
                  fingerprint changed -> disconnect + remove old tools/prompts,
                  then reconnect with new config; unchanged -> preserve as-is
                - Skip disabled / pending / untrusted directories; emit mcp-client-update
       |
       v
6. [CLI · Part B] UI cleanup: mcp-client-update refreshes MCP status indicators;
       optionally, MCP prompt changes -> reloadCommands(); set needsRefresh (sub-task 6)
```

**Layering rationale**: the core package should not know CLI `settings.json` / watcher semantics. **"When to trigger" belongs in CLI (Part B), while "how to update + reconcile" belongs in Core (Part A)**, matching the layering decision from sub-task 1. Part B is the only consumer of Part A, and they connect only through `Config` methods.

> **Two levels of trigger timing** (do not conflate them): `registerMcpHotReload` itself only runs **once at startup** (after `settingsWatcher.startWatching()` in `gemini.tsx`). Its job is only to attach a listener and return a disposer. The registered callback (the flow starting at step 3 above) is what the watcher triggers **on each later settings.json content change**. That is when reconcile actually runs.

> **Prerequisite: MCP-related schema keys must be "hot-reloadable" (the hidden switch in step 2).**
> Sub-task 1's `SettingsWatcher` has a "restart-required suppression gate": if a change touches only keys marked `requiresRestart: true` in `settingsSchema.ts`, the watcher **does not emit an event** (those values are only read at startup, so hot reload would be meaningless). `mcpServers` / `mcp.allowed` / `mcp.excluded` were originally all `true`, which means edits that only touch MCP config would never trigger the callback, making Part B inert (it would only "accidentally" work when another hot-reloadable setting changed at the same time). Therefore this MR **must** flip those three keys to `requiresRestart: false`. The check uses longest-prefix matching (`isRestartRequiredKey`, `settingsWatcher.ts:55`) plus recursive schema flattening (`flattenSchema`), so flipping the **leaf** keys is enough. The parent `mcp` node and startup-only `mcp.serverCommand` stay `true`: the former does not affect `mcp.allowed`/`mcp.excluded` because leaf keys win, and the latter is not part of reconcile input. Since all three keys have `showInDialog: false`, this flip **does not change** restart messaging in the settings dialog (`SettingsDialog.tsx`'s `requiresRestart()` only applies to visible dialog keys). The blast radius is limited to the watcher path.

The sections below cover Part A (Core capability), Part B (CLI wiring), and Part C (LSP, TODO only in this MR).

### Part A -- Core: Make Config Update MCP Config at Runtime and Trigger Incremental Reconcile

**File: `packages/core/src/config/config.ts`**

1. Add a post-init setter that updates the settings snapshot read by reconcile:

   ```ts
   /**
    * Replace the settings-layer MCP server map at runtime (hot reload).
    * Unlike addMcpServers(), this bypasses the `initialized` guard and is a
    * REPLACE (not merge), so removals take effect. Runtime overlay
    * (addRuntimeMcpServer) and extension contributions are not affected:
    * getMcpServers() still overlays them on top.
    */
   setMcpServers(servers: Record<string, MCPServerConfig> | undefined): void {
     this.mcpServers = servers;
   }
   ```

   `getMcpServers()` (`:3128`) already overlays extensions and `runtimeMcpServers` on top of `this.mcpServers`, so replacing only the settings layer is safe for runtime/extension entries.

2. **Connection admission lists**: three name lists determine whether each MCP server may connect: `excluded` (block connection), `allowed` (if set, only these names are allowed), and `pending` (gated sources requiring user approval before connection). These are separate from `mcpServers` (server config): the former decides **whether a server may connect**, while the latter decides **which servers exist and how to connect them**. Add setters for the three lists read by `getMcpServers()` / discovery: `setExcludedMcpServers()` already exists (`:3167`); add `setAllowedMcpServers()` (the field is currently `readonly` and used inside `getMcpServers()` for filtering), plus a setter for the pending-approval set.

3. Add a lightweight orchestration method: update config first, then drive the existing incremental reconcile, wrapped in a shared "reconcile in progress" guard so `/reload` (sub-task 5) and the watcher cannot race:

   ```ts
   /**
    * Apply a new settings-layer MCP map and incrementally reconcile live
    * connections (connect added, disconnect removed, restart changed; unchanged
    * servers stay untouched). Calling before initialize() is a safe no-op.
    */
   async reinitializeMcpServers(servers: Record<string, MCPServerConfig> | undefined): Promise<void> {
     this.setMcpServers(servers);
     const registry = this.getToolRegistry();
     await registry.getMcpClientManager().discoverAllMcpToolsIncremental(this);
   }
   ```

   `discoverAllMcpToolsIncremental` already checks `isTrustedFolder()`, handles disabled/SDK servers, and emits `mcp-client-update` to refresh UI status indicators. Removed server -> release + remove tools/prompts. Fingerprint changed -> release + reacquire. Unchanged -> preserve.

4. **Add pending-approval checks to the shared pool path** (trust boundary, required by this MR): the single-session path skips servers pending approval, but when a shared pool exists, `discoverAllMcpToolsIncremental` delegates to `runDiscoverAllMcpToolsViaPool`, and **the pool path currently skips disabled / SDK servers but does not check `isMcpServerPendingApproval`** (`mcp-client-manager.ts:1461` area). Without this fix, in daemon / shared-pool mode, a hot reload that adds or edits a gated `.mcp.json` / workspace server would acquire a pool connection and spawn a process **before** user approval, bypassing the #4615 approval gate. Fix: add `isMcpServerPendingApproval` checks in the pool path **before building `desiredIds` and before acquiring**, aligning admission semantics with the single-session path.

### Part B -- CLI: Subscribe SettingsWatcher -> MCP Reconcile

**New file: `packages/cli/src/config/hotReload.ts`**, wired after `settingsWatcher.startWatching()` (`:785`) in `gemini.tsx`.

```ts
export function registerMcpHotReload(
  watcher: SettingsWatcher,
  settings: LoadedSettings,
  config: Config,
  topTierMcpServers: Record<string, MCPServerConfig> | undefined,
): () => void {
  return watcher.addChangeListener(async (events) => {
    // Rebuild exactly like Config boot, including top-tier (CLI/session) sources.
    const next = assembleMcpServers(
      settings.merged.mcpServers,
      config.getTargetDir(),
      topTierMcpServers,
    );
    // Recompute connection admission lists (excluded/allowed/pending) from the
    // hot-reloaded settings. See the "admission direction" decision below;
    // pending is always recomputed for #4615 approval gating.
    const nextGating = {
      excluded: recomputeExcluded(settings, next),
      allowed: recomputeAllowed(settings, next),
      pending: recomputePending(settings, next),
    };
    // Gate: reconcile only if either mcpServers or MCP admission changed.
    // If both are unchanged, return early and ignore unrelated settings edits
    // such as theme / skills.
    const serversChanged = !mcpServersEqual(
      config.getSettingsMcpServers(),
      next,
    );
    const gatingChanged = !mcpGatingEqual(config.getMcpGating(), nextGating);
    if (!serversChanged && !gatingChanged) return;
    // Push connection admission lists into config before reconcile; discovery
    // inside reinitializeMcpServers reads them.
    config.setExcludedMcpServers(nextGating.excluded);
    config.setAllowedMcpServers(nextGating.allowed);
    config.setPendingMcpServers(nextGating.pending);
    await config.reinitializeMcpServers(next);
    // Notify UI: MCP prompt changes -> reloadCommands(); set needsRefresh (sub-task 6).
  });
}
```

> **Admission direction decision (intentionally opposite to Codex suggestion #1)**: hot reload uses **current settings as source of truth**. It does not treat the startup CLI allowlist (`--allowed-mcp-server-names`) as a permanent highest-priority constraint that suppresses later edits. That means if the user edits `settings.json` during a session and changes `mcp.allowed` / `mcp.excluded`, the new value takes effect immediately.
> _Tradeoff_: a runtime settings edit **can** broaden access beyond the startup CLI allowlist. We accept this because it matches the product goal of "settings hot reload takes effect immediately", and editing `settings.json` is the same class of trusted local-user operation as editing startup arguments. **Pending approval gating (#4615) is not relaxed**: gated-source servers always require approval first (see the pool-path hardening in Part A, item 4).

Reuse existing helpers. **Do not** reimplement merge logic:

- `assembleMcpServers(settings.mcpServers, cwd, topTierMcpServers)` -- `packages/cli/src/config/mcpServers.ts:27` (same call pattern as Config boot at `packages/cli/src/config/config.ts:1812`).
- `SettingsWatcher.addChangeListener` returns an unsubscribe function (`settingsWatcher.ts:253`).
- `config.getSettingsMcpServers()` (`:3124`) is the "before" image for the `mcpServers` diff.
- `config.getMcpGating()` is the "before" image for admission-list diff (a small new getter returning `{ excluded, allowed, pending }`, paired with the Part A setters).

Use two small pure functions to narrow the trigger surface, avoiding repeated reconcile on unrelated settings edits (theme, skills, etc.) and matching the watcher's semantic-diff philosophy. Both should **reuse `fast-deep-equal`** (already installed as a transitive dependency; the CLI package needs to promote it to a **direct dependency**) instead of hand-written deep comparison:

```ts
import equal from 'fast-deep-equal';

/**
 * Whether two mcpServers maps are equivalent. fast-deep-equal is insensitive to
 * object key order (which removes false positives from server order / field
 * order changes in settings.json), but sensitive to array order (`args` order is
 * semantically meaningful, which is correct). undefined is treated as {}.
 */
export function mcpServersEqual(
  a: Record<string, MCPServerConfig> | undefined,
  b: Record<string, MCPServerConfig> | undefined,
): boolean {
  return equal(a ?? {}, b ?? {});
}

export interface McpGating {
  excluded?: string[];
  allowed?: string[];
  pending?: string[];
}

/**
 * Whether admission lists are equivalent. excluded / allowed / pending have set
 * semantics, so order does not matter. fast-deep-equal is order-sensitive for
 * arrays, so compare sorted copies. undefined is treated as [].
 */
export function mcpGatingEqual(a: McpGating, b: McpGating): boolean {
  const norm = (xs: string[] | undefined) => [...(xs ?? [])].sort();
  return (
    equal(norm(a.excluded), norm(b.excluded)) &&
    equal(norm(a.allowed), norm(b.allowed)) &&
    equal(norm(a.pending), norm(b.pending))
  );
}
```

`mcpGatingEqual` is what makes "only `mcp.excluded` / `mcp.allowed` changed, `mcpServers` unchanged" still trigger reconcile. This fixes the gap where comparing only `mcpServers` would miss admission changes.

The UI notification callback routes the "MCP changed" signal through the existing `mcp-client-update` event (already consumed by status indicators), and/or through the app-state `needsRefresh` setter (sub-task 6). The minimum deliverable for this sub-task is: config-level reconcile completes and the existing emit refreshes status indicators. See the overview diagram at the start of this chapter for the end-to-end data flow.

### Part C -- LSP Reinitialize (Not Implemented in This MR, TODO)

LSP configuration comes from `.lsp.json` + extension configuration (**not** `settings.json`), so it **does not attach to SettingsWatcher auto-triggering**. Runtime reconnection should be manually driven later by the `/reload` command (sub-task 5). `NativeLspService` (controlled by the `--experimental-lsp` flag) already has lifecycle methods such as `discoverAndPrepare` / `start` / `stop`, enough to implement a `reinitialize()` primitive and expose it through `LspClient.reinitialize?()` + `Config.reinitializeLsp()` to `/reload`, without major changes.

> **TODO (next MR)**: implement `NativeLspService.reinitialize()` and expose it through `Config.reinitializeLsp()`. That MR's design doc should provide the detailed plan, including the fact that `discoverAndPrepare()` first calls `clearServerHandles()`, which prevents incremental diffing, and that v1 should use stop-all -> start-all. **This MR contains no LSP code changes.**

### Part D -- Follow-up Hardening: Hot Reload Triggers Runtime Approval Dialogs for Gated Servers (Connects to #4615)

> This section was added after Parts A/B landed, while investigating "editing a gated server URL does not reconnect". It fixes the broken link where hot reload marks a gated server as pending but the interactive UI does not show an approval dialog. It also fixes a missed prompt caused by the original predicate logic (issue #6 below).

#### Background: The Approval Dialog Originally Computed Once at Startup

For servers from gated sources (`project` `.mcp.json` and `workspace` `.qwen/settings.json`; see `isGatedMcpScope`), user approval is **bound to the config hash** (`getState` in `mcpApprovals.ts`: no record, or recorded hash differs from current config -> `pending`). Therefore, if a hot reload changes a gated server's config (even only `httpUrl`), the hash changes, invalidating the old approval and making the server `pending` again.

The Part A/B path already handles this **correctly**: `recomputeMcpGating` includes the server in `pending`, `setPendingMcpServers` pushes it to discovery, and reconcile skips it (does not connect; status `disconnected`). But **the interactive UI does not show an approval dialog**. Root cause: the queue in `useMcpApproval` (the hook that drives the approval dialog) is computed only once, on mount, through `useEffect(..., [config])`. The `config` reference is stable for the whole session, so the effect never reruns. In other words:

- Core marks the server pending (discovery skips it) ✓
- UI approval queue never recomputes -> **no dialog** ✗ (the user only sees `disconnected` and has no way to approve)

The two paths are **disconnected** at runtime.

#### Fix: Connect Core -> UI with an Event, Leave the Predicate Authority to UI

1. **Add event** `AppEvent.McpPendingApprovalChanged` (`packages/cli/src/utils/events.ts`).
   Because `appEvents` is in the CLI layer and `hotReload.ts` is also in the CLI layer, the listener can emit directly, with **no core changes**.

2. **`hotReload.ts` emits after reconcile** (after `await reinitializeMcpServers`, so `config.getMcpServers()` already reflects the new map; emit regardless of reconcile success because pending servers still need a user decision).

3. **Extract `computePending()` in `useMcpApproval`**: compute once on mount (existing behavior) **plus** subscribe to `McpPendingApprovalChanged` and recompute the queue. A non-empty queue opens the dialog. `computePending` recomputes from authoritative sources (the live server map + persisted approval file), so already-approved / already-rejected servers are not prompted again.

#### Key Design: Emit Based on "Strict Pending", Not Name Diff (Issue #6 / A1 Decision)

The two predicates below are **intentionally different**. This is the core of this section:

| Function                               | Predicate                                      | Purpose                                                           |
| -------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `getPendingGatedMcpServers`            | `state !== 'approved'` (**includes rejected**) | Feeds discovery: rejected servers must still be **skipped**       |
| `getPromptableMcpServers` (added here) | `state === 'pending'` (**excludes rejected**)  | Feeds the dialog: rejected servers should **not be nagged again** |

The original emit predicate used a **name diff** of `nextGating.pending` against the previous pending list to decide whether to show the dialog. That misses prompts (review issue #6):

- A **rejected** server remains in the `pending` list because rejected means `!== 'approved'`.
- The user later **edits the same server's config again** (hash changes -> it really becomes `pending` again and should ask again), but its name was "already in" the list -> the diff is empty -> **no event -> missed dialog**.

A1 fix: use `getPromptableMcpServers(next, cwd)` (strict `=== 'pending'`) to decide whether to emit, and let `computePending` be the source of truth. Result:

- After rejection, **editing the same server config** (hash changes) -> `pending` again -> **dialog shows again** ✓ (fixes #6)
- After rejection, an **unrelated** edit (hash unchanged) -> still `rejected` -> not promptable -> **no dialog** ✓
- Already `approved` -> no dialog; newly added pending gated server -> dialog ✓

#### Semantics of Reject (Confirmed After Cleanup)

`handleMcpApprovalSelect(REJECT)`: persist `rejected` (bound to the current hash), **do not** call `reconnect`, and **do not** mutate `config.pendingMcpServers`. Discovery continues skipping the server, so the server remains `disconnected`. There is no need to actively disconnect the old connection: the emit happens after `await reinitializeMcpServers`, so by the time the dialog appears, reconcile has already torn down the old connection. After session restart, `computePending` reads `rejected`, does not enqueue it, and keeps it disconnected, preserving behavior.

#### Data Flow Addendum (After Step 6 in This Chapter's Overview Diagram)

```text
6' [CLI · Part D] After reconcile, if any gated server is strictly pending:
        hotReload -> appEvents.emit(McpPendingApprovalChanged)
        -> useMcpApproval.computePending() recomputes queue -> approval dialog opens
        -> user approves: approveMcpServerForSession + discoverToolsForServer
           (connect with new config)
           user rejects: persist rejected, keep disconnected
```

#### Key Files (Part D)

| File                                          | Change                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/utils/events.ts`            | Add `AppEvent.McpPendingApprovalChanged`                                                                               |
| `packages/cli/src/config/mcpApprovals.ts`     | Add `getPromptableMcpServers()` (strict `=== 'pending'`, distinct from rejected-inclusive `getPendingGatedMcpServers`) |
| `packages/cli/src/config/hotReload.ts`        | After reconcile, use `getPromptableMcpServers`; if non-empty, `appEvents.emit(McpPendingApprovalChanged)`              |
| `packages/cli/src/ui/hooks/useMcpApproval.ts` | Extract `computePending()`; compute on mount plus recompute on subscribed event                                        |

#### Verification (Part D)

- `hotReload.test.ts`: gated server newly enters pending -> emit; non-gated change -> no emit; **reject -> edit config -> emit again** (the old name-diff logic would call zero times, locking the #6 regression); reject -> unrelated edit -> no emit.
- `mcpApprovals.test.ts`: `getPromptableMcpServers` suite: no decision prompts, rejected does not prompt (while `getPendingGatedMcpServers` still skips it), changed hash prompts again, approved does not prompt.
- `useMcpApproval.test.ts`: mid-session event opens the dialog for a new gated server; already-approved servers are not prompted again.

#### Known Issue / Later Retrospective TODO (Not Handled Here)

1. **`getTargetDir()` vs `getWorkingDir()` key mismatch (risk B)**: gating recomputation (`recomputeMcpGating` -> `getPendingGatedMcpServers`) uses `config.getTargetDir()` as projectRoot, while `useMcpApproval` reads / writes approvals using `config.getWorkingDir()`. They are usually equal. If they diverge (custom cwd, or symlink realpath differences), approval is written under the cwd key while gating checks the targetDir key -> **after approve, gating still skips the server and it never connects**. This is an existing issue, not introduced by Part D. Recommendation: unify on one root (prefer `getWorkingDir()`, the approval writer), or first add an assertion confirming they are always equal at runtime.

---

## Out of Scope (Other Sub-tasks)

- **Full LSP runtime reconnection** (`NativeLspService.reinitialize()` + `Config.reinitializeLsp()` + wiring) -- left for a later MR; see the TODO in Part C.
- `/reload` slash command (#5) -- call `config.reinitializeMcpServers(currentSettings)` (LSP part to be wired after its primitive lands in a later MR) + reload skills/commands.
- `clearAllCaches()` (#4) and `needsRefresh` UI notification (#6).

## Key Files

| File                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/config/config.ts`            | `setMcpServers()`, `setAllowedMcpServers()` + pending setter, `getMcpGating()` (returns `{ excluded, allowed, pending }`), `reinitializeMcpServers()` (with reconcile-in-progress guard)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/core/src/tools/mcp-client-manager.ts` | 1. Add `removePromptsByServer()` to `removeServer()` and `removeRuntimeMcpServer()`; 2. in the shared pool path `runDiscoverAllMcpToolsViaPool` (`:1461`), add `isMcpServerPendingApproval` checks before building `desiredIds` and before acquire (align with single-session admission); 3. **add fingerprint diff to single-session path**: add `connectionFingerprints` map so `discoverAllMcpToolsIncremental` also disconnects/reconnects servers that are already connected but whose `connectionIdOf` fingerprint changed (align with shared pool `desiredIds`), and clean this map on all teardown paths; 4. **clean old tools/prompts before reconnect**: when `discoverMcpToolsForServerInternal` replaces an existing client, call `removeMcpToolsByServer` + `removePromptsByServer` before rediscovery. Because `disconnect()` does not touch the registry and `discover()` only appends/overwrites by name, otherwise tools removed/renamed by config changes would remain and be bound to a closed client (and would also remain if discovery fails), aligning with existing cleanup in `removeServer` / `addRuntimeMcpServer` |
| `packages/cli/src/config/settingsSchema.ts`     | **Prerequisite**: flip `mcpServers` (`:274`), `mcp.allowed`, and `mcp.excluded` from `requiresRestart: true` to `false`, so the watcher no longer suppresses MCP-only edits. Keep parent `mcp` and `mcp.serverCommand` as `true` (see the prerequisite note above)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `packages/cli/src/config/hotReload.ts` _(new)_  | `registerMcpHotReload()`: rebuild through `assembleMcpServers(..., topTierMcpServers)`; recompute connection admission lists from current settings (see "Admission direction decision"); gate through `mcpServersEqual` + `mcpGatingEqual` (based on `fast-deep-equal`); debounce + coalesce-and-recheck                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/cli/package.json`                     | Promote `fast-deep-equal` from transitive dependency to **direct dependency**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/cli/src/gemini.tsx`                   | Call `registerMcpHotReload` after `:785`; register disposer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Tests _(with schema flip)_                      | `settingsSchema.test.ts` pins the `requiresRestart` values for the three MCP keys (and that `mcp` / `mcp.serverCommand` remain `true`); `settingsWatcher.test.ts` adds two positive regressions: "only `mcpServers` changed / only `mcp.excluded` changed -> still notify"; `settingsUtils.test.ts` uses its **own mock schema**, unrelated to the real flip, so it needs no changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

> LSP-related files (`NativeLspService.ts` / `NativeLspClient.ts` / `lsp/types.ts`) are not changed in this MR; see the Part C TODO.

## Verification

### A. Core Capability Unit Tests (`config.test.ts` / `mcp-client-manager.test.ts`)

1. `setMcpServers` is **replace (not merge)** and works post-init (no longer throws because of the `initialized` guard).
2. `reinitializeMcpServers` calls `setMcpServers` before `discoverAllMcpToolsIncremental`; calling it before `initialize()` is a **safe no-op** (does not throw or connect).
3. Assert that `removeServer()` / `removeRuntimeMcpServer()` now call `removePromptsByServer()` (prompt leak regression guard). Reuse `mcp-client-manager.test.ts` fixtures (already import `connectionIdOf`).
   3b. **Single-session path fingerprint diff**: use a mock client whose `getStatus()` always returns `CONNECTED`, run `discoverAllMcpToolsIncremental` three times: first connect records fingerprint; rerun with the same config does **not** churn (`connect` still called once); mutate `args` in place (fingerprint changes) -> disconnect/reconnect (`disconnect` once, `connect` twice). This guards against the single-session path treating "connected but config changed" as a no-op (aligning with shared pool `desiredIds`). Also assert this run calls `removeMcpToolsByServer` + `removePromptsByServer` before rediscovery for that server, guarding "clean old tools/prompts before reconnect" and preventing removed/renamed tools from lingering after config changes (Codex adversarial review #2).

### A'. Watcher <-> Schema Integration Guards (`settingsSchema.test.ts` / `settingsWatcher.test.ts`)

> These two tests come from a **high** severity integration break identified by Codex adversarial review: MCP-only edits would be swallowed by the watcher's restart-required suppression gate, so the Part B callback would never fire. This **must** be covered at the real watcher layer; directly invoking the callback in `hotReload.test.ts` cannot catch that failure.

3c. **Schema pinned values** (`settingsSchema.test.ts`): `mcpServers` / `mcp.allowed` / `mcp.excluded` have `requiresRestart: false`; parent `mcp` and `mcp.serverCommand` have `requiresRestart: true`. This prevents someone from accidentally changing MCP keys back to restart-required and silently disabling the whole hot reload path.
3d. **Real watcher no longer suppresses** (`settingsWatcher.test.ts`, real `SettingsWatcher` + mock fs): changing only `mcpServers`, and changing only `mcp.excluded`, each triggers exactly one `SettingsChangeEvent` (before the flip, both would be suppressed). This is the end-to-end regression guard that sub-task 3's listener can actually be triggered.

### B. Subscriber Gate Branch Unit Tests (`hotReload.test.ts`)

Use a fake `SettingsWatcher` and cover every gate branch:

4. **`mcpServers` changed** -> call `reinitializeMcpServers` with the **assembled** map (including top-tier).
5. **Only `mcp.excluded` changed (or `mcp.allowed` / pending), `mcpServers` unchanged** -> still trigger reconcile, and call `setExcludedMcpServers` / `setAllowedMcpServers` / `setPendingMcpServers` before reconcile. This specifically verifies the `mcpGatingEqual` branch and fixes the gap where comparing only `mcpServers` would miss this change.
6. **Both `mcpServers` and MCP admission lists are unchanged** (for example, theme / skills edit) -> **do not** call `reinitializeMcpServers` (verifies early return when both gates are unchanged).
7. **Two changes arrive while reconcile is in flight** -> coalesce-and-recheck runs one more time (reentrancy).
8. **Debounce**: consecutive saves within < 300ms trigger only **one** reconcile (aligned with the watcher's 300ms debounce).

### C. Gate Helper Pure Function Unit Tests (`hotReload.test.ts`)

9. `mcpServersEqual`: different key order with same values -> `true`; nested config field (`args` / `env` / `headers`) changes -> `false`; `undefined` and `{}` -> `true`; add / remove one server -> `false`; `args` array order change -> `false` (command argument order is semantic).
10. `mcpGatingEqual`: the three lists compare as sets, order-insensitive (`['a','b']` vs `['b','a']` -> `true`); adding/removing any item in any list -> `false`; `undefined` and `[]` -> `true`.

### D. Trust Boundary Cases (CLI + Core)

> Both cases come from **high** severity trust-boundary points identified by Codex adversarial review. Test 11 validates this design's "admission direction decision" (hot reload uses settings as source of truth). Test 12 corresponds to Part A item 4 (pending check hardening in the pool path).

11. **Hot-reload connection admission uses current settings as source of truth** (implements the "admission direction decision").
    Start with `--allowed-mcp-server-names=a`; then change settings so `mcp.allowed` includes `b`. **Assert**: after reconcile, the admission list recomputed from current settings takes effect, and `b` becomes visible / connectable. In other words, a runtime settings edit **can** broaden beyond the startup CLI allowlist (an intentional product direction, not a bug).
    _Guarded behavior_: in Part B, `nextGating` is fully recomputed from current settings and is not pinned by the startup CLI allowlist.

12. **Pending approval gating is not bypassed in shared pool mode** (high risk: connect a gated server before approval).
    In daemon / shared pool mode (`runDiscoverAllMcpToolsViaPool`), hot reload adds or edits a `.mcp.json` / workspace server that is pending approval. **Assert**: before user approval, the path does **not** acquire a pool connection or spawn a process; rejected gated servers remain disconnected. The single-session path already skips pending; this test guards the pool path.
    _Guarded behavior_: Part A item 4 -- the `isMcpServerPendingApproval` checks before building `desiredIds` and before acquire in the pool path.

### E. Reconcile Boundary Cases (Recommended Coverage, Verifies "Incremental, Not Full Restart")

13. **Empty <-> non-empty**: going from 0 servers to 1 (first server), and from 1 to 0 (last server), both reconcile correctly without lingering connections / tools / prompts.
14. **Fingerprint change only moves one server**: changing one server's `command` / `url` / `env` / `headers` disconnects and reconnects only that server, while **all other connections remain intact** (verifies no full clear and no "zero tools" window).
15. **Untrusted directory**: when `isTrustedFolder()` is false, hot reload is a no-op (does not establish any connection).
16. **`mcp.excluded` toggle**: adding an online server to excluded disconnects it and removes tools/prompts; removing it from excluded reconnects it.
