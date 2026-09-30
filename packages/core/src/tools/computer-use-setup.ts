/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ApprovalMode } from '../config/approval-mode.js';
import type { Config } from '../config/config.js';
import type { MCPServerConfig } from '../config/mcp-server-config.js';
import type { PermissionDecision } from '../permissions/types.js';
import { getErrorMessage, isNodeError } from '../utils/errors.js';
import { ToolErrorType } from './tool-error.js';
import { ToolDisplayNames, ToolNames } from './tool-names.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';

export const COMPUTER_USE_NODE_REPL_VERSION = '0.1.6';
export const COMPUTER_USE_CUA_SDK_VERSION = '0.20.11';
export const COMPUTER_USE_MCP_SERVER_NAME = 'computer-use-node-repl';
export const COMPUTER_USE_NODE_REPL_TOOL_NAME =
  'mcp__computer_use_node_repl__node_repl';

const RUNTIME_FORMAT_VERSION = 1;
const RUNTIME_ID =
  `node-repl-${COMPUTER_USE_NODE_REPL_VERSION}_` +
  `cua-sdk-${COMPUTER_USE_CUA_SDK_VERSION}`;
const READY_FILE = 'ready.json';
const execFileAsync = promisify(execFile);

interface ComputerUseRuntimeManifest {
  formatVersion: number;
  nodeReplVersion: string;
  cuaSdkVersion: string;
}

export interface ComputerUseRuntime {
  root: string;
  nodeReplEntrypoint: string;
  reused: boolean;
}

export type InstallComputerUsePackages = (
  stagingRoot: string,
  signal: AbortSignal,
) => Promise<void>;

export interface EnsureComputerUseRuntimeOptions {
  signal: AbortSignal;
  homeDir?: string;
  installPackages?: InstallComputerUsePackages;
}

type EnsureComputerUseRuntime = (
  signal: AbortSignal,
) => Promise<ComputerUseRuntime>;

type ComputerUseSetupParams = Record<string, never>;

function expectedManifest(): ComputerUseRuntimeManifest {
  return {
    formatVersion: RUNTIME_FORMAT_VERSION,
    nodeReplVersion: COMPUTER_USE_NODE_REPL_VERSION,
    cuaSdkVersion: COMPUTER_USE_CUA_SDK_VERSION,
  };
}

function runtimeRoot(homeDir: string): string {
  return path.join(homeDir, '.qwen', 'computer-use', 'runtimes', RUNTIME_ID);
}

function nodeReplEntrypoint(root: string): string {
  return path.join(
    root,
    'node_modules',
    '@qwen-code',
    'node-repl-mcp',
    'dist',
    'index.js',
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJsonObject(
  filePath: string,
): Promise<Record<string, unknown>> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Expected a regular file: ${filePath}`);
  }
  const value: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected a JSON object: ${filePath}`);
  }
  return value as Record<string, unknown>;
}

async function verifyPackageVersion(
  root: string,
  packageName: string,
  expectedVersion: string,
): Promise<void> {
  const manifestPath = path.join(
    root,
    'node_modules',
    ...packageName.split('/'),
    'package.json',
  );
  const manifest = await readJsonObject(manifestPath);
  if (manifest['version'] !== expectedVersion) {
    throw new Error(
      `Computer Use runtime package mismatch for ${packageName}: ` +
        `expected ${expectedVersion}, found ${String(manifest['version'])}.`,
    );
  }
}

async function verifyRuntime(
  root: string,
  requireReadyFile: boolean,
): Promise<string> {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Computer Use runtime is not a directory: ${root}`);
  }

  if (requireReadyFile) {
    const ready = await readJsonObject(path.join(root, READY_FILE));
    const expected = expectedManifest();
    for (const [key, value] of Object.entries(expected)) {
      if (ready[key] !== value) {
        throw new Error(
          `Computer Use runtime manifest mismatch for ${key}: ` +
            `expected ${String(value)}, found ${String(ready[key])}.`,
        );
      }
    }
  }

  await verifyPackageVersion(
    root,
    '@qwen-code/node-repl-mcp',
    COMPUTER_USE_NODE_REPL_VERSION,
  );
  await verifyPackageVersion(
    root,
    '@qwen-code/cua-sdk',
    COMPUTER_USE_CUA_SDK_VERSION,
  );

  const entrypoint = nodeReplEntrypoint(root);
  const entrypointStat = await fs.lstat(entrypoint);
  if (!entrypointStat.isFile()) {
    throw new Error(
      `Computer Use Node REPL entrypoint is missing: ${entrypoint}`,
    );
  }
  return entrypoint;
}

async function verifyPublishedRuntime(root: string): Promise<string> {
  try {
    return await verifyRuntime(root, true);
  } catch (error) {
    throw new Error(
      `Existing Computer Use runtime is invalid: ${getErrorMessage(error)} ` +
        `Remove ${root} and retry setup.`,
    );
  }
}

async function verifyNativePayload(root: string): Promise<void> {
  const nativeAssetsPath = path.join(
    root,
    'node_modules',
    '@qwen-code',
    'cua-sdk',
    'dist',
    'native-assets.js',
  );
  const nativeAssetsStat = await fs.lstat(nativeAssetsPath);
  if (!nativeAssetsStat.isFile()) {
    throw new Error(
      `Computer Use native asset resolver is missing: ${nativeAssetsPath}`,
    );
  }
  const nativeAssets: unknown = await import(
    pathToFileURL(nativeAssetsPath).href
  );
  const resolveNativeDirectory = (
    nativeAssets as { resolveNativeDirectory?: unknown }
  ).resolveNativeDirectory;
  if (typeof resolveNativeDirectory !== 'function') {
    throw new Error(
      `Computer Use native asset resolver is invalid: ${nativeAssetsPath}`,
    );
  }
  resolveNativeDirectory();
}

async function ensureNativePayload(
  root: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await verifyNativePayload(root);
    return;
  } catch (verificationError) {
    const installer = path.join(
      root,
      'node_modules',
      '@qwen-code',
      'cua-sdk',
      'scripts',
      'install-native.mjs',
    );
    try {
      const installerStat = await fs.lstat(installer);
      if (!installerStat.isFile()) {
        throw new Error(`Expected a regular file: ${installer}`);
      }
      await execFileAsync(process.execPath, [installer], {
        cwd: path.dirname(installer),
        signal,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      await verifyNativePayload(root);
    } catch (repairError) {
      throw new Error(
        `Computer Use native payload is unavailable (${getErrorMessage(
          verificationError,
        )}); repair failed: ${getErrorMessage(repairError)}`,
      );
    }
  }
}

async function installPackagesWithNpm(
  stagingRoot: string,
  signal: AbortSignal,
): Promise<void> {
  const npmName = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const pairedNpm = path.join(path.dirname(process.execPath), npmName);
  const npm = (await pathExists(pairedNpm)) ? pairedNpm : npmName;
  await execFileAsync(
    npm,
    [
      'install',
      '--prefix',
      stagingRoot,
      '--no-save',
      '--package-lock=false',
      '--omit=dev',
      '--ignore-scripts=false',
      '--audit=false',
      '--fund=false',
      `@qwen-code/node-repl-mcp@${COMPUTER_USE_NODE_REPL_VERSION}`,
      `@qwen-code/cua-sdk@${COMPUTER_USE_CUA_SDK_VERSION}`,
    ],
    {
      cwd: stagingRoot,
      signal,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

export async function ensureComputerUseRuntime(
  options: EnsureComputerUseRuntimeOptions,
): Promise<ComputerUseRuntime> {
  const root = runtimeRoot(options.homeDir ?? homedir());
  if (await pathExists(root)) {
    const entrypoint = await verifyPublishedRuntime(root);
    await ensureNativePayload(root, options.signal);
    return { root, nodeReplEntrypoint: entrypoint, reused: true };
  }

  options.signal.throwIfAborted();
  const parent = path.dirname(root);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const stagingRoot = await fs.mkdtemp(
    path.join(parent, `.${RUNTIME_ID}.${process.pid}.`),
  );
  let stagingOwned = true;

  try {
    await fs.writeFile(
      path.join(stagingRoot, 'package.json'),
      `${JSON.stringify(
        {
          private: true,
          dependencies: {
            '@qwen-code/node-repl-mcp': COMPUTER_USE_NODE_REPL_VERSION,
            '@qwen-code/cua-sdk': COMPUTER_USE_CUA_SDK_VERSION,
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    await (options.installPackages ?? installPackagesWithNpm)(
      stagingRoot,
      options.signal,
    );
    options.signal.throwIfAborted();
    await verifyRuntime(stagingRoot, false);
    await ensureNativePayload(stagingRoot, options.signal);
    await fs.writeFile(
      path.join(stagingRoot, READY_FILE),
      `${JSON.stringify(expectedManifest(), null, 2)}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    await verifyRuntime(stagingRoot, true);

    try {
      await fs.rename(stagingRoot, root);
      stagingOwned = false;
      return {
        root,
        nodeReplEntrypoint: nodeReplEntrypoint(root),
        reused: false,
      };
    } catch (error) {
      if (!(await pathExists(root))) throw error;
      const winnerEntrypoint = await verifyPublishedRuntime(root);
      await ensureNativePayload(root, options.signal);
      return {
        root,
        nodeReplEntrypoint: winnerEntrypoint,
        reused: true,
      };
    }
  } finally {
    if (stagingOwned) {
      await fs.rm(stagingRoot, { recursive: true, force: true });
    }
  }
}

class ComputerUseSetupInvocation extends BaseToolInvocation<
  ComputerUseSetupParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    private readonly ensureRuntime: EnsureComputerUseRuntime,
    params: ComputerUseSetupParams,
  ) {
    super(params);
  }

  override getDescription(): string {
    return 'Install and connect the Qwen-managed Computer Use runtime';
  }

  override getDefaultPermission(): Promise<PermissionDecision> {
    return Promise.resolve(
      this.config.getApprovalMode() === ApprovalMode.PLAN ? 'deny' : 'ask',
    );
  }

  override async execute(signal: AbortSignal): Promise<ToolResult> {
    if (this.config.getApprovalMode() === ApprovalMode.PLAN) {
      return failureResult(
        'Computer Use setup is unavailable in Plan Mode. Exit Plan Mode before installing or starting the runtime.',
      );
    }

    try {
      signal.throwIfAborted();
      const runtime = await this.ensureRuntime(signal);
      const registry = this.config.getToolRegistry();
      const manager = registry.getMcpClientManager();
      const serverConfig: MCPServerConfig = {
        command: process.execPath,
        args: [runtime.nodeReplEntrypoint],
        cwd: runtime.root,
        trust: false,
        description: 'Qwen-managed Computer Use Node REPL',
        scope: 'system',
        alwaysLoadTools: true,
      };
      const result = await manager.addRuntimeMcpServer(
        COMPUTER_USE_MCP_SERVER_NAME,
        serverConfig,
        this.config.getSessionId(),
      );
      if ('skipped' in result) {
        throw new Error(
          `Computer Use MCP registration was skipped: ${result.reason}.`,
        );
      }
      if (result.toolCount === 0) {
        await manager.removeRuntimeMcpServer(
          COMPUTER_USE_MCP_SERVER_NAME,
          this.config.getSessionId(),
        );
        throw new Error('Computer Use Node REPL connected without any tools.');
      }

      await this.config.getLlmClient().setTools();
      const action = runtime.reused ? 'reused' : 'installed';
      const message =
        `Computer Use runtime ${action} and connected for this session. ` +
        `Continue with ${COMPUTER_USE_NODE_REPL_TOOL_NAME}; no Qwen Code restart is required.`;
      return { llmContent: message, returnDisplay: message };
    } catch (error) {
      return failureResult(getErrorMessage(error));
    }
  }
}

export class ComputerUseSetupTool extends BaseDeclarativeTool<
  ComputerUseSetupParams,
  ToolResult
> {
  static readonly Name = ToolNames.COMPUTER_USE_SETUP;

  constructor(
    private readonly config: Config,
    private readonly ensureRuntime: EnsureComputerUseRuntime = (signal) =>
      ensureComputerUseRuntime({ signal }),
  ) {
    super(
      ComputerUseSetupTool.Name,
      ToolDisplayNames.COMPUTER_USE_SETUP,
      'Installs the pinned Qwen-managed Computer Use runtime outside the workspace and connects its Node REPL to the current session without restarting Qwen Code. Call only when no desktop relay, managed Computer Use Node REPL, or user Node REPL is available.',
      Kind.Other,
      {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      true,
      false,
      false,
      true,
      'computer use desktop node repl setup install restartless',
    );
  }

  protected override createInvocation(
    params: ComputerUseSetupParams,
  ): ToolInvocation<ComputerUseSetupParams, ToolResult> {
    return new ComputerUseSetupInvocation(
      this.config,
      this.ensureRuntime,
      params,
    );
  }
}

function failureResult(message: string): ToolResult {
  return {
    llmContent: `Computer Use setup failed: ${message}`,
    returnDisplay: `Computer Use setup failed: ${message}`,
    error: {
      message,
      type: ToolErrorType.EXECUTION_FAILED,
    },
  };
}
