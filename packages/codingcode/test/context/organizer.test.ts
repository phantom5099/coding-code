import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../src/context/service.js';
import { SessionService } from '../../src/session/store.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
import type { SessionEvent, ToolResultEvent } from '../../src/session/types.js';

const baseConfig = {
  microCompactThreshold: 0.5,
  microCompactMinChars: 120,
  compactionThreshold: 0.9,
  keepRecentTurns: 1,
  compactionModel: '',
  reactiveCompactMaxRetries: 3,
};

function makeUserEvent(content: string, turnId: number): SessionEvent {
  return { type: 'user', uuid: `u${turnId}`, content, turnId, timestamp: new Date().toISOString() };
}

function makeAssistant(content: string, turnId: number): SessionEvent {
  return {
    type: 'assistant',
    uuid: `a${turnId}`,
    content,
    turnId,
    toolCalls: [],
    model: 'test',
    timestamp: new Date().toISOString(),
  };
}

function makeToolResult(
  toolName: string,
  output: string,
  turnId: number,
  uuid: string
): ToolResultEvent {
  return {
    type: 'tool_result',
    uuid,
    parentUuid: 'a1',
    toolName,
    toolCallId: `tc${uuid}`,
    output,
    turnId,
    timestamp: new Date().toISOString(),
    tokenCount: 0,
  };
}

const TestLayer = Layer.merge(
  SessionService.Default,
  Layer.succeed(LLMFactoryService, {
    listModels: () => Effect.succeed([]),
    findModel: () => Effect.succeed(null),
    getActiveEntry: () => Effect.fail(new Error('no active model')),
    switchModel: () => Effect.fail(new Error('no models')),
    createClient: () => Effect.fail(new Error('no client')),
    getLLMClient: () => Effect.fail(new Error('no client')),
  } as any)
);

describe('assemblePayload', () => {
  it('is importable and exists as a method on ContextService', async () => {
    const svc = await Effect.runPromise(
      Effect.gen(function* () {
        const ctx = yield* ContextService;
        return ctx;
      }).pipe(Effect.provide(ContextService.Default), Effect.provide(TestLayer))
    );
    expect(typeof svc.assemblePayload).toBe('function');
  });
});
