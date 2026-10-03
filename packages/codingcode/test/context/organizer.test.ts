import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../src/context/port.js';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { LLMService } from '../../src/llm/port.js';
import type { SessionEvent, ToolResultEvent } from '../../src/contracts/session.js';
import { ContextLayer } from '../../src/context/context.js';

const baseConfig = {
  compactionModel: '',
};

function makeUserEvent(content: string, turnId: number): SessionEvent {
  return { type: 'user', content, turnId };
}

function makeAssistant(content: string, turnId: number): SessionEvent {
  return {
    type: 'assistant',
    content,
    turnId,
    toolCalls: [],
  };
}

function makeToolResult(
  toolName: string,
  output: string,
  turnId: number,
  toolCallId: string
): ToolResultEvent {
  return {
    type: 'tool_result',
    toolName,
    toolCallId,
    output,
    turnId,
  };
}

const TestLayer = Layer.merge(
  SessionLayer,
  Layer.succeed(LLMService, {
    complete: () => Effect.fail(new Error('no llm')),
    completeStream: () => (async function* () {})(),
  } as any)
);

describe('assemblePayload', () => {
  it('is importable and exists as a method on ContextService', async () => {
    const svc = await Effect.runPromise(
      Effect.gen(function* () {
        const ctx = yield* ContextService;
        return ctx;
      }).pipe(Effect.provide(ContextLayer), Effect.provide(TestLayer))
    );
    expect(typeof svc.assemblePayload).toBe('function');
  });
});
