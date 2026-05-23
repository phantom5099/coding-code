import { expect, it, describe, vi } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from '../../src/agent/agent';
import { Result } from '../../src/core/result';
import type { RunStreamOptions } from '../../src/agent/agent';
import { randomUUID } from 'crypto';

describe('runReActLoop — stop hook', () => {
  const mockState = {
    sessionId: 'test-session',
    cwd: process.cwd(),
    currentTurnId: randomUUID(),
    sessionMeta: { model: 'test-model', version: '0.1.0', createdAt: new Date().toISOString() } as any,
    title: 'test',
    tokenCountEstimate: 0,
  };

  function baseMockDeps(overrides: Record<string, any> = {}) {
    return {
      maxSteps: 5,
      executor: {} as any,
      toolRegistry: {
        allCore: () => [],
        allDeferred: () => [],
      } as any,
      toolSearch: {
        isLoaded: () => false,
        listUnloadedDeferred: () => [],
      } as any,
      agentIdResolver: { resolve: () => 'agent-id' } as any,
      ctx: {
        build: () => Effect.succeed([]),
        compress: () => Effect.succeed({ released: 0 }),
        appendTurnEnd: () => Effect.succeed(undefined),
      } as any,
      session: {
        recordAssistant: () => Effect.succeed({ uuid: 'a1' }),
        recordToolResult: () => Effect.succeed({}),
        recordUser: () => Effect.succeed({ uuid: 'm1' }),
      } as any,
      checkpoint: { snapshotFinal: () => {} } as any,
      dedup: null,
      hooks: {
        emit: vi.fn(() => Effect.succeed(undefined)),
        emitDecision: vi.fn(() => Effect.succeed(null)),
      },
      ...overrides,
    };
  }

  it('should continue iteration when stop hook returns continue decision', async () => {
    let callCount = 0;
    const mockLlm = {
      completeStream: vi.fn(() => {
        callCount++;
        return {
          stream: (async function* () {})(),
          response: Promise.resolve(
            Result.ok({ content: `Response ${callCount}`, toolCalls: [] }),
          ),
        };
      }),
    };

    const emitDecisionFn = vi.fn((point: string) => {
      if (point === 'agent.turn.stop') {
        return Effect.succeed({ decision: 'continue', injection: 'Run again' });
      }
      return Effect.succeed(null);
    });

    const deps = baseMockDeps({
      maxSteps: 5,
      hooks: {
        emit: vi.fn(() => Effect.succeed(undefined)),
        emitDecision: emitDecisionFn,
      },
    });

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
    };

    const gen = runReActLoop(opts, deps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(emitDecisionFn).toHaveBeenCalledWith(
      'agent.turn.stop',
      expect.objectContaining({ sessionId: mockState.sessionId }),
    );
  });

  it('should respect maxStopContinuations limit', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({ content: 'Response', toolCalls: [] }),
        ),
      })),
    };

    const deps = baseMockDeps({
      maxSteps: 10,
      hooks: {
        emit: vi.fn(() => Effect.succeed(undefined)),
        emitDecision: vi.fn((point: string) => {
          if (point === 'agent.turn.stop') {
            return Effect.succeed({ decision: 'continue', injection: 'Continue' });
          }
          return Effect.succeed(null);
        }),
      },
    });

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      maxStopContinuations: 2,
    };

    const gen = runReActLoop(opts, deps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    const errorEvent = events.find((e: any) => e._tag === 'Error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error?.code).toBe('STOP_LOOP');
  });

  it('should use default maxStopContinuations of 2', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({ content: 'Response', toolCalls: [] }),
        ),
      })),
    };

    let continueCount = 0;
    const deps = baseMockDeps({
      maxSteps: 10,
      hooks: {
        emit: vi.fn(() => Effect.succeed(undefined)),
        emitDecision: vi.fn((point: string) => {
          if (point === 'agent.turn.stop') {
            continueCount++;
            return Effect.succeed({ decision: 'continue', injection: 'Continue' });
          }
          return Effect.succeed(null);
        }),
      },
    });

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
    };

    const gen = runReActLoop(opts, deps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(continueCount).toBeGreaterThanOrEqual(2);
  });

  it('should not continue if stop hook returns null', async () => {
    let llmCalls = 0;
    const mockLlm = {
      completeStream: vi.fn(() => {
        llmCalls++;
        return {
          stream: (async function* () {})(),
          response: Promise.resolve(
            Result.ok({ content: 'Response', toolCalls: [] }),
          ),
        };
      }),
    };

    const deps = baseMockDeps({
      maxSteps: 5,
      hooks: {
        emit: vi.fn(() => Effect.succeed(undefined)),
        emitDecision: vi.fn(() => Effect.succeed(null)),
      },
    });

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
    };

    const gen = runReActLoop(opts, deps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(llmCalls).toBe(1);
    const doneEvent = events.find((e: any) => e._tag === 'Done');
    expect(doneEvent).toBeDefined();
  });

  it('should use injection message to record user event', async () => {
    const recordUserFn = vi.fn(() => Effect.succeed({ uuid: 'msg-id' }));

    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({ content: 'Response', toolCalls: [] }),
        ),
      })),
    };

    const deps = baseMockDeps({
      maxSteps: 5,
      session: {
        recordAssistant: () => Effect.succeed({ uuid: 'a1' }),
        recordToolResult: () => Effect.succeed({}),
        recordUser: recordUserFn,
      } as any,
      hooks: {
        emit: vi.fn(() => Effect.succeed(undefined)),
        emitDecision: vi.fn((point: string) => {
          if (point === 'agent.turn.stop') {
            return Effect.succeed({ decision: 'continue', injection: 'Custom injection message' });
          }
          return Effect.succeed(null);
        }),
      },
    });

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      maxStopContinuations: 1,
    };

    const gen = runReActLoop(opts, deps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(recordUserFn).toHaveBeenCalledWith(
      mockState,
      'Custom injection message',
    );
  });

  it('should use default injection if not provided', async () => {
    const recordUserFn = vi.fn(() => Effect.succeed({ uuid: 'msg-id' }));

    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({ content: 'Response', toolCalls: [] }),
        ),
      })),
    };

    const deps = baseMockDeps({
      maxSteps: 5,
      session: {
        recordAssistant: () => Effect.succeed({ uuid: 'a1' }),
        recordToolResult: () => Effect.succeed({}),
        recordUser: recordUserFn,
      } as any,
      hooks: {
        emit: vi.fn(() => Effect.succeed(undefined)),
        emitDecision: vi.fn((point: string) => {
          if (point === 'agent.turn.stop') {
            return Effect.succeed({ decision: 'continue' });
          }
          return Effect.succeed(null);
        }),
      },
    });

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      maxStopContinuations: 1,
    };

    const gen = runReActLoop(opts, deps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(recordUserFn).toHaveBeenCalledWith(
      mockState,
      '(continue)',
    );
  });
});
