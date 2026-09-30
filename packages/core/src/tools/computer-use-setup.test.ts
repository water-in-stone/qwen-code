/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalMode } from '../config/approval-mode.js';
import type { Config } from '../config/config.js';
import { LocalExecutionEnvironment } from '../services/local-execution-environment.js';
import { makeFakeConfig } from '../test-utils/config.js';
import {
  COMPUTER_USE_CUA_SDK_VERSION,
  COMPUTER_USE_MCP_SERVER_NAME,
  COMPUTER_USE_NODE_REPL_TOOL_NAME,
  COMPUTER_USE_NODE_REPL_VERSION,
  ComputerUseSetupTool,
  ensureComputerUseRuntime,
  type InstallComputerUsePackages,
} from './computer-use-setup.js';
import { ToolNames } from './tool-names.js';

const tempHomes: string[] = [];

async function makeTempHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-cua-home-'));
  tempHomes.push(home);
  return home;
}

async function writeFakePackages(
  root: string,
  versions: {
    nodeRepl?: string;
    cuaSdk?: string;
  } = {},
): Promise<void> {
  const nodeReplRoot = path.join(
    root,
    'node_modules',
    '@qwen-code',
    'node-repl-mcp',
  );
  const cuaSdkRoot = path.join(root, 'node_modules', '@qwen-code', 'cua-sdk');
  await fs.mkdir(path.join(nodeReplRoot, 'dist'), { recursive: true });
  await fs.mkdir(path.join(cuaSdkRoot, 'dist'), { recursive: true });
  await fs.mkdir(path.join(cuaSdkRoot, 'scripts'), { recursive: true });
  await fs.writeFile(
    path.join(nodeReplRoot, 'package.json'),
    JSON.stringify({
      version: versions.nodeRepl ?? COMPUTER_USE_NODE_REPL_VERSION,
    }),
  );
  await fs.writeFile(path.join(nodeReplRoot, 'dist', 'index.js'), '');
  await fs.writeFile(
    path.join(cuaSdkRoot, 'package.json'),
    JSON.stringify({
      version: versions.cuaSdk ?? COMPUTER_USE_CUA_SDK_VERSION,
      type: 'module',
    }),
  );
  await fs.writeFile(
    path.join(cuaSdkRoot, 'dist', 'native-assets.js'),
    `import { existsSync } from 'node:fs';
const marker = new URL('./fake-native-ready', import.meta.url);
export function resolveNativeDirectory() {
  if (!existsSync(marker)) throw new Error('fake native payload missing');
  return new URL('.', import.meta.url).pathname;
}
`,
  );
  await fs.writeFile(
    path.join(cuaSdkRoot, 'scripts', 'install-native.mjs'),
    `import { writeFile } from 'node:fs/promises';
await writeFile(new URL('../dist/fake-native-ready', import.meta.url), '');
`,
  );
  await fs.writeFile(path.join(cuaSdkRoot, 'dist', 'fake-native-ready'), '');
}

afterEach(async () => {
  await Promise.all(
    tempHomes
      .splice(0)
      .map((home) => fs.rm(home, { recursive: true, force: true })),
  );
});

describe('ensureComputerUseRuntime', () => {
  it('installs through a staging directory and reuses the published runtime', async () => {
    const homeDir = await makeTempHome();
    const installPackages = vi.fn<InstallComputerUsePackages>(
      async (stagingRoot) => {
        expect(path.basename(stagingRoot)).toMatch(
          /^\.node-repl-0\.1\.6_cua-sdk-0\.20\.11\.\d+\./,
        );
        await writeFakePackages(stagingRoot);
      },
    );

    const first = await ensureComputerUseRuntime({
      homeDir,
      signal: AbortSignal.timeout(5_000),
      installPackages,
    });
    const second = await ensureComputerUseRuntime({
      homeDir,
      signal: AbortSignal.timeout(5_000),
      installPackages,
    });

    expect(first.reused).toBe(false);
    expect(second).toEqual({ ...first, reused: true });
    expect(installPackages).toHaveBeenCalledTimes(1);
    expect(first.root).toBe(
      path.join(
        homeDir,
        '.qwen',
        'computer-use',
        'runtimes',
        'node-repl-0.1.6_cua-sdk-0.20.11',
      ),
    );
    await expect(fs.lstat(first.nodeReplEntrypoint)).resolves.toMatchObject({});
    const siblings = await fs.readdir(path.dirname(first.root));
    expect(siblings).toEqual([path.basename(first.root)]);
  });

  it('fails closed when a published package version is changed', async () => {
    const homeDir = await makeTempHome();
    const runtime = await ensureComputerUseRuntime({
      homeDir,
      signal: AbortSignal.timeout(5_000),
      installPackages: async (stagingRoot) => {
        await writeFakePackages(stagingRoot);
      },
    });
    await fs.writeFile(
      path.join(
        runtime.root,
        'node_modules',
        '@qwen-code',
        'cua-sdk',
        'package.json',
      ),
      JSON.stringify({ version: '0.0.0' }),
    );

    await expect(
      ensureComputerUseRuntime({
        homeDir,
        signal: AbortSignal.timeout(5_000),
        installPackages: vi.fn(),
      }),
    ).rejects.toThrow(
      `expected 0.20.11, found 0.0.0. Remove ${runtime.root} and retry setup.`,
    );
  });

  it('cleans its staging directory when installation fails', async () => {
    const homeDir = await makeTempHome();
    await expect(
      ensureComputerUseRuntime({
        homeDir,
        signal: AbortSignal.timeout(5_000),
        installPackages: async (stagingRoot) => {
          await writeFakePackages(stagingRoot);
          throw new Error('postinstall failed');
        },
      }),
    ).rejects.toThrow('postinstall failed');

    const runtimeParent = path.join(
      homeDir,
      '.qwen',
      'computer-use',
      'runtimes',
    );
    expect(await fs.readdir(runtimeParent)).toEqual([]);
  });

  it('does not inherit QWEN_HOME for the product runtime path', async () => {
    const homeDir = await makeTempHome();
    vi.stubEnv('QWEN_HOME', path.join(homeDir, 'workspace-qwen-home'));
    try {
      const runtime = await ensureComputerUseRuntime({
        homeDir,
        signal: AbortSignal.timeout(5_000),
        installPackages: async (stagingRoot) => {
          await writeFakePackages(stagingRoot);
        },
      });
      expect(runtime.root).toContain(
        path.join(homeDir, '.qwen', 'computer-use', 'runtimes'),
      );
      expect(runtime.root).not.toContain('workspace-qwen-home');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('repairs a missing native payload before reusing the runtime', async () => {
    const homeDir = await makeTempHome();
    const runtime = await ensureComputerUseRuntime({
      homeDir,
      signal: AbortSignal.timeout(5_000),
      installPackages: async (stagingRoot) => {
        await writeFakePackages(stagingRoot);
      },
    });
    const nativeMarker = path.join(
      runtime.root,
      'node_modules',
      '@qwen-code',
      'cua-sdk',
      'dist',
      'fake-native-ready',
    );
    await fs.rm(nativeMarker);

    const reused = await ensureComputerUseRuntime({
      homeDir,
      signal: AbortSignal.timeout(5_000),
      installPackages: vi.fn(),
    });

    expect(reused.reused).toBe(true);
    await expect(fs.lstat(nativeMarker)).resolves.toMatchObject({});
  });

  it('publishes one valid winner when first-use installations overlap', async () => {
    const homeDir = await makeTempHome();
    let started = 0;
    let releaseBoth: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const installPackages: InstallComputerUsePackages = async (stagingRoot) => {
      await writeFakePackages(stagingRoot);
      started += 1;
      if (started === 2) releaseBoth?.();
      await bothStarted;
    };

    const [first, second] = await Promise.all([
      ensureComputerUseRuntime({
        homeDir,
        signal: AbortSignal.timeout(5_000),
        installPackages,
      }),
      ensureComputerUseRuntime({
        homeDir,
        signal: AbortSignal.timeout(5_000),
        installPackages,
      }),
    ]);

    expect(started).toBe(2);
    expect(first.root).toBe(second.root);
    expect([first.reused, second.reused].sort()).toEqual([false, true]);
    const siblings = await fs.readdir(path.dirname(first.root));
    expect(siblings).toEqual([path.basename(first.root)]);
  });
});

describe('ComputerUseSetupTool', () => {
  function makeToolConfig(mode: ApprovalMode = ApprovalMode.DEFAULT) {
    const addRuntimeMcpServer = vi.fn().mockResolvedValue({
      name: COMPUTER_USE_MCP_SERVER_NAME,
      transport: 'stdio',
      replaced: false,
      shadowedSettings: false,
      toolCount: 5,
      originatorClientId: 'session-1',
    });
    const removeRuntimeMcpServer = vi.fn();
    const setTools = vi.fn().mockResolvedValue(undefined);
    const config = {
      getApprovalMode: vi.fn(() => mode),
      getSessionId: vi.fn(() => 'session-1'),
      getToolRegistry: vi.fn(() => ({
        getMcpClientManager: () => ({
          addRuntimeMcpServer,
          removeRuntimeMcpServer,
        }),
      })),
      getLlmClient: vi.fn(() => ({ setTools })),
    } as unknown as Config;
    return {
      config,
      addRuntimeMcpServer,
      removeRuntimeMcpServer,
      setTools,
    };
  }

  it('connects the fixed runtime server and refreshes active tools', async () => {
    const { config, addRuntimeMcpServer, setTools } = makeToolConfig();
    const ensureRuntime = vi.fn().mockResolvedValue({
      root: '/home/user/.qwen/computer-use/runtimes/runtime',
      nodeReplEntrypoint:
        '/home/user/.qwen/computer-use/runtimes/runtime/node_modules/@qwen-code/node-repl-mcp/dist/index.js',
      reused: false,
    });
    const tool = new ComputerUseSetupTool(config, ensureRuntime);
    const invocation = tool.build({});

    await expect(invocation.getDefaultPermission()).resolves.toBe('ask');
    const result = await invocation.execute(AbortSignal.timeout(5_000));

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain(COMPUTER_USE_NODE_REPL_TOOL_NAME);
    expect(addRuntimeMcpServer).toHaveBeenCalledWith(
      COMPUTER_USE_MCP_SERVER_NAME,
      expect.objectContaining({
        command: process.execPath,
        trust: false,
        scope: 'system',
        alwaysLoadTools: true,
      }),
      'session-1',
    );
    expect(setTools).toHaveBeenCalledOnce();
  });

  it('rejects Plan Mode before installation or MCP registration', async () => {
    const { config, addRuntimeMcpServer, setTools } = makeToolConfig(
      ApprovalMode.PLAN,
    );
    const ensureRuntime = vi.fn();
    const invocation = new ComputerUseSetupTool(config, ensureRuntime).build(
      {},
    );

    await expect(invocation.getDefaultPermission()).resolves.toBe('deny');
    const result = await invocation.execute(AbortSignal.timeout(5_000));

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('Plan Mode');
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(addRuntimeMcpServer).not.toHaveBeenCalled();
    expect(setTools).not.toHaveBeenCalled();
  });
});

describe('computer_use_setup registration', () => {
  it('registers only for the main interactive local session', async () => {
    const interactive = makeFakeConfig({ interactive: true });
    const mainRegistry = await interactive.createToolRegistry(undefined, {
      skipDiscovery: true,
    });
    expect(mainRegistry.getAllToolNames()).toContain(
      ToolNames.COMPUTER_USE_SETUP,
    );

    const variants = [
      makeFakeConfig({ interactive: false }),
      makeFakeConfig({ interactive: true, sdkMode: true }),
      makeFakeConfig({ interactive: true, safeMode: true }),
      makeFakeConfig({ interactive: true, bareMode: true }),
    ];
    for (const config of variants) {
      const registry = await config.createToolRegistry(undefined, {
        skipDiscovery: true,
      });
      expect(registry.getAllToolNames()).not.toContain(
        ToolNames.COMPUTER_USE_SETUP,
      );
    }

    const subagentRegistry = await interactive.createToolRegistry(undefined, {
      skipDiscovery: true,
      forSubAgent: true,
    });
    expect(subagentRegistry.getAllToolNames()).not.toContain(
      ToolNames.COMPUTER_USE_SETUP,
    );

    const sandboxRoot = await makeTempHome();
    const workspace = path.join(sandboxRoot, 'workspace');
    const installation = path.join(sandboxRoot, 'installation');
    const state = path.join(sandboxRoot, 'state');
    await Promise.all([
      fs.mkdir(workspace),
      fs.mkdir(installation),
      fs.mkdir(state),
    ]);
    const sandboxConfig = makeFakeConfig({
      targetDir: workspace,
      cwd: workspace,
      interactive: true,
      shellExecutionSandbox: {
        workspace,
        installation,
        state,
        filesystem: 'workspace-write',
        network: 'closed',
      },
    });
    const sandboxRegistry = await sandboxConfig.createToolRegistry(undefined, {
      skipDiscovery: true,
    });
    expect(sandboxRegistry.getAllToolNames()).not.toContain(
      ToolNames.COMPUTER_USE_SETUP,
    );

    const executionHost = makeFakeConfig({ interactive: true });
    const executionEnvironment = new LocalExecutionEnvironment(executionHost);
    const executionConfig = makeFakeConfig({
      interactive: true,
      executionEnvironment,
    });
    const executionRegistry = await executionConfig.createToolRegistry(
      undefined,
      { skipDiscovery: true },
    );
    expect(executionRegistry.getAllToolNames()).not.toContain(
      ToolNames.COMPUTER_USE_SETUP,
    );
    await executionEnvironment.dispose();
  });
});
