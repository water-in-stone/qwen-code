/**
 * @license
 * Copyright 2026 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { parseSkillContent } from '../../skill-load.js';

function loadComputerUseSkill() {
  const skillPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'SKILL.md',
  );
  const config = parseSkillContent(
    fs.readFileSync(skillPath, 'utf-8'),
    skillPath,
  );
  return { config, body: config.body };
}

describe('bundled computer-use skill', () => {
  it.each(['desktop', 'managed', 'regular'] as const)(
    'runs the forwarding example with %s Node REPL selected',
    async (selected) => {
      const { body } = loadComputerUseSkill();
      const example = body.match(/```js\n([\s\S]*?)\n```/)?.[1];
      expect(example).toBeDefined();
      const screenshot = {
        type: 'image',
        data: 'screenshot',
        mimeType: 'image/png',
      };
      const result = {
        content: [{ type: 'text', text: 'macos' }, screenshot],
      };
      const desktop = vi.fn().mockResolvedValue(result);
      const managed = vi.fn().mockResolvedValue(result);
      const regular = vi.fn().mockResolvedValue(result);
      const text = vi.fn();
      const image = vi.fn();
      // Mirror the code-mode host (host.ts): a Proxy that throws on an
      // unknown key, so an unbound desktop tool must be probed with `in`.
      const toolTarget = Object.assign(Object.create(null), {
        mcp__node_repl__node_repl: regular,
        ...(selected === 'desktop'
          ? { mcp__desktop_node_repl__node_repl: desktop }
          : {}),
        ...(selected !== 'regular'
          ? { mcp__computer_use_node_repl__node_repl: managed }
          : {}),
      }) as Record<string, unknown>;
      const tools = new Proxy(toolTarget, {
        get(target, property) {
          if (typeof property === 'string' && !(property in target)) {
            throw new Error(
              `Unknown or unavailable code mode tool: ${property}`,
            );
          }
          return Reflect.get(target, property) as unknown;
        },
      });
      await runInNewContext(`(async () => {${example}})()`, {
        tools,
        code: 'return platform',
        text,
        image,
      });
      const expected =
        selected === 'desktop'
          ? desktop
          : selected === 'managed'
            ? managed
            : regular;
      expect(expected).toHaveBeenCalledWith({
        code: 'return platform',
      });
      for (const candidate of [desktop, managed, regular]) {
        if (candidate !== expected) expect(candidate).not.toHaveBeenCalled();
      }
      expect(text).toHaveBeenCalledWith('macos');
      expect(image).toHaveBeenCalledWith(screenshot);
    },
  );

  it('loads a self-contained App workflow for every connected platform', () => {
    const { config, body } = loadComputerUseSkill();
    expect(config.name).toBe('computer-use');
    expect(config.allowedTools).toBeUndefined();
    expect(body).toContain('`desktop-node-repl`');
    expect(body).toContain('mcp__desktop_node_repl__node_repl');
    expect(body).toContain('mcp__computer_use_node_repl__node_repl');
    expect(body).toContain('computer_use_setup');
    expect(body).toContain('ComputerUse.create()');
    expect(body).toContain('await computer.getPlatform()');
    expect(body).toContain('computer.getApp(');
    expect(body).toContain('app.getState(');
    expect(body).toContain('app.click(37)');
    expect(body).not.toMatch(
      /references\/|computer\.observeWindow\(|computer\.listWindows\(|elementToken|windowId/,
    );
  });

  it('uses restartless product setup instead of workspace installation', () => {
    const { body } = loadComputerUseSkill();
    expect(body).toContain('without changing the');
    expect(body).toContain('restarting Qwen Code');
    expect(body).toContain('Do not install packages into the workspace');
    expect(body).not.toContain('qwen mcp add');
    expect(body).not.toContain('npm install');
    expect(body).not.toContain('Tell the user to restart');
  });

  it('preserves batching, incremental observation and safe refresh guidance', () => {
    const { body } = loadComputerUseSkill();
    expect(body).toMatch(/After performing one or more UI actions/);
    expect(body).toMatch(/Batch actions whose target remains the same/);
    expect(body).toContain('Prefer this default diff output');
    expect(body).toContain('disableDiff: true');
    expect(body).toMatch(/window or session changes/);
    expect(body).toContain('maxTextChars?: number');
    expect(body).toContain('12,000 characters');
    expect(body).toContain('Only currently captured actionable IDs');
    expect(body).toMatch(
      /Partial, unconfirmed or cancelled actions must not be blindly repeated/,
    );
    expect(body).not.toMatch(
      /RecreationBench|benchmark|evaluator|score|failure count/i,
    );
  });

  it('requests screenshots separately and keeps the persistent REPL lifecycle', () => {
    const { body } = loadComputerUseSkill();
    const screenshotSection = body.split('## Reading screenshots')[1];
    expect(screenshotSection).toContain('includeScreenshot: true');
    expect(screenshotSection).not.toContain('disableDiff');
    expect(screenshotSection).toContain('image.dataBase64');
    expect(screenshotSection).toContain('nodeRepl.write(state.text)');
    expect(body).toContain('await computer.close()');
    expect(body).toContain(
      'Reset the Node REPL only when no other persistent state is needed.',
    );
  });

  it('documents the macOS text methods and their uncertainty boundaries', () => {
    const { body } = loadComputerUseSkill();
    expect(body).toContain('app.selectText(37,');
    expect(body).toContain("await app.paste('ready')");
    expect(body).toContain("format?: 'text' | 'md' | 'html'");
    expect(body).toContain(
      "selection?: 'text' | 'cursor_before' | 'cursor_after'",
    );
    expect(body).toContain('immediately adjacent');
    expect(body).toContain('Missing or');
    expect(body).toContain('ambiguous matches fail');
    expect(body).toContain('Observe state before');
    expect(body).toContain('newer external clipboard change');
  });
});
