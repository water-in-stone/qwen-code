/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_PENDING_PROMPTS_PER_SESSION,
  InvalidPromptQueueMetadataError,
  PROMPT_QUEUE_LIST_METHOD,
  PROMPT_QUEUE_REMOVE_METHOD,
  addPromptQueueCapabilityToMeta,
  buildPendingPromptAddedData,
  buildPendingPromptCompletedData,
  buildPromptQueueFullErrorData,
  isValidPromptQueueServerId,
  parseAndStripPromptQueueMetadata,
} from './promptQueueProtocol.js';

describe('prompt queue protocol', () => {
  it('merges capability metadata without overwriting siblings', () => {
    const meta = addPromptQueueCapabilityToMeta(
      {
        imageCapability: { maxImagesPerTurn: 4 },
        qwen: {
          connectionId: 'connection-1',
          methods: ['existing/method', PROMPT_QUEUE_LIST_METHOD],
        },
      },
      DEFAULT_MAX_PENDING_PROMPTS_PER_SESSION,
    );

    expect(meta).toMatchObject({
      imageCapability: { maxImagesPerTurn: 4 },
      qwen: {
        connectionId: 'connection-1',
        methods: [
          'existing/method',
          PROMPT_QUEUE_LIST_METHOD,
          PROMPT_QUEUE_REMOVE_METHOD,
        ],
        promptQueue: {
          version: 1,
          delivery: 'next_turn',
          maxPendingPromptsPerSession: 5,
          sessionCancelScope: 'running_only',
          notificationMethod: '_qwen/notify',
        },
      },
    });
  });

  it('strips only queue-control metadata and returns correlation', () => {
    expect(
      parseAndStripPromptQueueMetadata({
        trace: 'keep',
        qwen: {
          sibling: true,
          promptQueue: { clientPromptId: 'local:1' },
        },
      }),
    ).toEqual({
      clientPromptId: 'local:1',
      meta: { trace: 'keep', qwen: { sibling: true } },
    });
  });

  it.each([
    null,
    'bad',
    { clientPromptId: '' },
    { clientPromptId: 'contains spaces' },
    { clientPromptId: 'x'.repeat(129) },
  ])('rejects invalid queue metadata %#', (promptQueue) => {
    expect(() =>
      parseAndStripPromptQueueMetadata({ qwen: { promptQueue } }),
    ).toThrow(InvalidPromptQueueMetadataError);
  });

  it('builds versioned events and queue-full data', () => {
    expect(
      buildPendingPromptAddedData({
        sessionId: 's1',
        promptId: 'p1',
        clientPromptId: 'c1',
        text: 'hello',
        queuedAt: 1,
      }),
    ).toEqual({
      version: 1,
      sessionId: 's1',
      promptId: 'p1',
      clientPromptId: 'c1',
      text: 'hello',
      queuedAt: 1,
    });
    expect(
      buildPendingPromptCompletedData({
        sessionId: 's1',
        promptId: 'p1',
        state: 'removed',
      }),
    ).toMatchObject({ version: 1, state: 'removed' });
    expect(buildPromptQueueFullErrorData('s1', 5, 5)).toEqual({
      errorKind: 'prompt_queue_full',
      sessionId: 's1',
      limit: 5,
      pendingCount: 5,
      retryable: true,
    });
  });

  it('accepts only canonical v4 server ids', () => {
    expect(
      isValidPromptQueueServerId('550e8400-e29b-41d4-a716-446655440000'),
    ).toBe(true);
    expect(isValidPromptQueueServerId('not-a-uuid')).toBe(false);
    expect(
      isValidPromptQueueServerId('550e8400-e29b-11d4-a716-446655440000'),
    ).toBe(false);
  });
});
