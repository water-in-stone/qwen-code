/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PENDING_PROMPT_ADDED_EVENT,
  PENDING_PROMPT_COMPLETED_EVENT,
  PENDING_PROMPT_STARTED_EVENT,
} from './daemonEventTypes.js';

export {
  PENDING_PROMPT_ADDED_EVENT,
  PENDING_PROMPT_COMPLETED_EVENT,
  PENDING_PROMPT_STARTED_EVENT,
};

export const PROMPT_QUEUE_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_MAX_PENDING_PROMPTS_PER_SESSION = 5;
export const PROMPT_QUEUE_NOTIFICATION_METHOD = '_qwen/notify';
export const PROMPT_QUEUE_LIST_METHOD = '_qwen/session/prompt_queue/list';
export const PROMPT_QUEUE_REMOVE_METHOD = '_qwen/session/prompt_queue/remove';
export const PROMPT_QUEUE_METHODS = [
  PROMPT_QUEUE_LIST_METHOD,
  PROMPT_QUEUE_REMOVE_METHOD,
] as const;

export const PROMPT_QUEUE_CLIENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const PROMPT_QUEUE_SERVER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PROMPT_QUEUE_PROMPT_ID_MAX_LENGTH = 128;

export type PromptQueueEventKind =
  | typeof PENDING_PROMPT_ADDED_EVENT
  | typeof PENDING_PROMPT_STARTED_EVENT
  | typeof PENDING_PROMPT_COMPLETED_EVENT;

export interface PromptQueueCapabilityV1 {
  version: typeof PROMPT_QUEUE_PROTOCOL_VERSION;
  delivery: 'next_turn';
  maxPendingPromptsPerSession: number | null;
  sessionCancelScope: 'running_only';
  notificationMethod: typeof PROMPT_QUEUE_NOTIFICATION_METHOD;
  events: readonly PromptQueueEventKind[];
}

export interface PromptQueueEventIdentityV1 {
  version: typeof PROMPT_QUEUE_PROTOCOL_VERSION;
  sessionId: string;
  promptId: string;
  clientPromptId?: string;
}

export interface PendingPromptAddedDataV1 extends PromptQueueEventIdentityV1 {
  text: string;
  queuedAt: number;
}

export interface PendingPromptStartedDataV1 extends PromptQueueEventIdentityV1 {
  text: string;
}

export interface PendingPromptCompletedDataV1
  extends PromptQueueEventIdentityV1 {
  state: 'completed' | 'removed';
}

export interface PromptQueueProtocolErrorData {
  errorKind: 'prompt_queue_full';
  sessionId: string;
  limit: number;
  pendingCount: number;
  retryable: true;
}

export class InvalidPromptQueueMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPromptQueueMetadataError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidPromptQueueClientId(value: unknown): value is string {
  return (
    typeof value === 'string' && PROMPT_QUEUE_CLIENT_ID_PATTERN.test(value)
  );
}

export function isValidPromptQueueServerId(value: unknown): value is string {
  return (
    typeof value === 'string' && PROMPT_QUEUE_SERVER_ID_PATTERN.test(value)
  );
}

export function isValidPromptQueuePromptId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= PROMPT_QUEUE_PROMPT_ID_MAX_LENGTH &&
    value.trim().length > 0 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  );
}

export function buildPromptQueueCapability(
  maxPendingPromptsPerSession: number | null,
): PromptQueueCapabilityV1 {
  return {
    version: PROMPT_QUEUE_PROTOCOL_VERSION,
    delivery: 'next_turn',
    maxPendingPromptsPerSession,
    sessionCancelScope: 'running_only',
    notificationMethod: PROMPT_QUEUE_NOTIFICATION_METHOD,
    events: [
      PENDING_PROMPT_ADDED_EVENT,
      PENDING_PROMPT_STARTED_EVENT,
      PENDING_PROMPT_COMPLETED_EVENT,
    ],
  };
}

export function addPromptQueueCapabilityToMeta(
  meta: Record<string, unknown> | undefined,
  maxPendingPromptsPerSession: number | null,
): Record<string, unknown> {
  const currentMeta = meta ?? {};
  const currentQwen = isRecord(currentMeta['qwen']) ? currentMeta['qwen'] : {};
  const currentMethods = Array.isArray(currentQwen['methods'])
    ? currentQwen['methods'].filter(
        (method): method is string => typeof method === 'string',
      )
    : [];
  return {
    ...currentMeta,
    qwen: {
      ...currentQwen,
      methods: [...new Set([...currentMethods, ...PROMPT_QUEUE_METHODS])],
      promptQueue: buildPromptQueueCapability(maxPendingPromptsPerSession),
    },
  };
}

export function parseAndStripPromptQueueMetadata(
  meta: Record<string, unknown> | undefined,
): {
  clientPromptId?: string;
  meta?: Record<string, unknown>;
} {
  if (!meta) return {};
  const sanitizedMeta = { ...meta };
  const qwen = meta['qwen'];
  if (!isRecord(qwen) || qwen['promptQueue'] === undefined) {
    return { meta: sanitizedMeta };
  }
  const promptQueue = qwen['promptQueue'];
  if (!isRecord(promptQueue)) {
    throw new InvalidPromptQueueMetadataError(
      '`_meta.qwen.promptQueue` must be an object',
    );
  }
  const clientPromptId = promptQueue['clientPromptId'];
  if (
    clientPromptId !== undefined &&
    !isValidPromptQueueClientId(clientPromptId)
  ) {
    throw new InvalidPromptQueueMetadataError(
      '`clientPromptId` must match [A-Za-z0-9._:-]{1,128}',
    );
  }
  const sanitizedQwen = { ...qwen };
  delete sanitizedQwen['promptQueue'];
  if (Object.keys(sanitizedQwen).length === 0) {
    delete sanitizedMeta['qwen'];
  } else {
    sanitizedMeta['qwen'] = sanitizedQwen;
  }
  return {
    ...(clientPromptId !== undefined ? { clientPromptId } : {}),
    ...(Object.keys(sanitizedMeta).length > 0 ? { meta: sanitizedMeta } : {}),
  };
}

export function buildPendingPromptAddedData(
  input: Omit<PendingPromptAddedDataV1, 'version'>,
): PendingPromptAddedDataV1 {
  return { version: PROMPT_QUEUE_PROTOCOL_VERSION, ...input };
}

export function buildPendingPromptStartedData(
  input: Omit<PendingPromptStartedDataV1, 'version'>,
): PendingPromptStartedDataV1 {
  return { version: PROMPT_QUEUE_PROTOCOL_VERSION, ...input };
}

export function buildPendingPromptCompletedData(
  input: Omit<PendingPromptCompletedDataV1, 'version'>,
): PendingPromptCompletedDataV1 {
  return { version: PROMPT_QUEUE_PROTOCOL_VERSION, ...input };
}

export function buildPromptQueueFullErrorData(
  sessionId: string,
  limit: number,
  pendingCount: number,
): PromptQueueProtocolErrorData {
  return {
    errorKind: 'prompt_queue_full',
    sessionId,
    limit,
    pendingCount,
    retryable: true,
  };
}
