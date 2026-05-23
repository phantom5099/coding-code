import { expect, it, describe, vi } from 'vitest';
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

  it('should continue iteration when stop hook returns continue decision', async () => {
    let callCount = 0;
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(() => {
          callCount++;
          if (callCount === 1) {
            // First call returns no tool calls (normally would end)
            return Result.ok({
              content: `Response ${callCount}`,
              toolCalls: [],
            });
          } else {
            // Second call after continue
            return Result.ok({
              content: `Response ${callCount}`,
              toolCalls: [],
            });
          }
        })(),
      })),
    };

    const emitDecisionFn = vi.fn(async (point: string) => {
      if (point === 'agent.turn.stop') {
        return { decision: 'continue', injection: 'Run again' };
      }
      return null;
    });

    const mockDeps = {
      maxSteps: 5,
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: { resolve: () => 'agent-id' } as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {
        recordUser: () => ({ uuid: 'msg-id' }),
      } as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: {
        emit: vi.fn(async () => {}),
        emitDecision: emitDecisionFn,
      },
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
    };

    const gen = runReActLoop(opts, mockDeps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    // Should have processed the continue decision
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
          Result.ok({
            content: 'Response',
            toolCalls: [],
          }),
        ),
      })),
    };

    const mockDeps = {
      maxSteps: 10,
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: { resolve: () => 'agent-id' } as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {
        recordUser: () => ({ uuid: 'msg-id' }),
      } as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: {
        emit: vi.fn(async () => {}),
        emitDecision: vi.fn(async (point: string) => {
          if (point === 'agent.turn.stop') {
            // Always want to continue
            return { decision: 'continue', injection: 'Continue' };
          }
          return null;
        }),
      },
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      maxStopContinuations: 2, // Allow only 2 continuations
    };

    const gen = runReActLoop(opts, mockDeps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    // Should error when exceeding maxStopContinuations
    const errorEvent = events.find((e: any) => e._tag === 'Error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error?.code).toBe('STOP_LOOP');
  });

  it('should use default maxStopContinuations of 2', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Response',
            toolCalls: [],
          }),
        ),
      })),
    };

    let continueCount = 0;
    const mockDeps = {
      maxSteps: 10,
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: { resolve: () => 'agent-id' } as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {
        recordUser: () => ({ uuid: 'msg-id' }),
      } as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: {
        emit: vi.fn(async () => {}),
        emitDecision: vi.fn(async (point: string) => {
          if (point === 'agent.turn.stop') {
            continueCount++;
            return { decision: 'continue', injection: 'Continue' };
          }
          return null;
        }),
      },
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      // No maxStopContinuations specified, should default to 2
    };

    const gen = runReActLoop(opts, mockDeps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    // Should have attempted 3 times (initial + 2 continues) before erroring
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
            Result.ok({
              content: 'Response',
              toolCalls: [],
            }),
          ),
        };
      }),
    };

    const mockDeps = {
      maxSteps: 5,
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: { resolve: () => 'agent-id' } as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {} as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: {
        emit: vi.fn(async () => {}),
        emitDecision: vi.fn(async () => null), // Return null - no continue
      },
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
    };

    const gen = runReActLoop(opts, mockDeps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    // Should have only called LLM once and returned Done
    expect(llmCalls).toBe(1);
    const doneEvent = events.find((e: any) => e._tag === 'Done');
    expect(doneEvent).toBeDefined();
  });

  it('should use injection message to record user event', async () => {
    const recordUserFn = vi.fn(() => ({ uuid: 'msg-id' }));

    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Response',
            toolCalls: [],
          }),
        ),
      })),
    };

    const mockDeps = {
      maxSteps: 5,
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: { resolve: () => 'agent-id' } as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {
        recordUser: recordUserFn,
      } as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: {
        emit: vi.fn(async () => {}),
        emitDecision: vi.fn(async (point: string) => {
          if (point === 'agent.turn.stop') {
            return { decision: 'continue', injection: 'Custom injection message' };
          }
          return null;
        }),
      },
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      maxStopContinuations: 1,
    };

    const gen = runReActLoop(opts, mockDeps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    // Should have recorded the injection message
    expect(recordUserFn).toHaveBeenCalledWith(
      mockState,
      'Custom injection message',
    );
  });

  it('should use default injection if not provided', async () => {
    const recordUserFn = vi.fn(() => ({ uuid: 'msg-id' }));

    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Response',
            toolCalls: [],
          }),
        ),
      })),
    };

    const mockDeps = {
      maxSteps: 5,
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: { resolve: () => 'agent-id' } as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {
        recordUser: recordUserFn,
      } as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: {
        emit: vi.fn(async () => {}),
        emitDecision: vi.fn(async (point: string) => {
          if (point === 'agent.turn.stop') {
            return { decision: 'continue' }; // No injection provided
          }
          return null;
        }),
      },
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      maxStopContinuations: 1,
    };

    const gen = runReActLoop(opts, mockDeps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    // Should have recorded default injection
    expect(recordUserFn).toHaveBeenCalledWith(
      mockState,
      '(continue)',
    );
  });
});
