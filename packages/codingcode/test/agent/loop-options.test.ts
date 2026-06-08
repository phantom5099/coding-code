import { expect, it, describe, vi } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from '../../src/agent/agent';
import { Result } from '../../src/core/result';
import type { RunStreamOptions } from '../../src/agent/agent';
import { randomUUID } from 'crypto';

describe('runReActLoop 鈥?loop options', () => {
  const mockState = {
    sessionId: 'test-session',
    cwd: process.cwd(),
    currentTurnId: 0,
    sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
    title: 'test',
    usage: undefined,
    projectPath: '',
    transcriptPath: '',
    indexPath: '',
    messageCount: 0,
    promptEstimate: 0,
  };

  const mockHooks = {
    emit: vi.fn(() => Effect.succeed(undefined)),
    emitDecision: vi.fn(() => Effect.succeed(null)),
  } as any;

  function baseMockDeps(overrides: Record<string, any> = {}) {
    return {
      maxSteps: 1,
      maxStopContinuations: 2,
      executor: {} as any,
      runtime: { listAgentProfiles: () => [] } as any,
      agentIdResolver: { resolve: () => 'agent-id' } as any,
      agentService: { runStream: () => (async function* () {})() } as any,
      ctx: {
        build: () =>
          Effect.succeed({
            messages: [{ role: 'user' as const, content: 'hi' }],
            newBudgets: [],
            promptEstimate: 0,
          }),
        compress: () => Effect.succeed({ didCompress: false, released: 0, promptEstimate: 0 }),
        appendTurnEnd: () => Effect.succeed(undefined),
        compactIfNeeded: () =>
          Effect.succeed({ didCompress: false, released: 0, promptEstimate: 0 }),
      } as any,
      session: {
        recordAssistant: () => Effect.succeed({ uuid: 'a1' }),
        recordToolResult: () => Effect.succeed({}),
        recordUser: () => Effect.succeed({ uuid: 'm1' }),
      } as any,
      checkpoint: { snapshotFinal: () => {} } as any,
      hooks: mockHooks,
      ...overrides,
    };
  }

  it('should accept systemOverride to replace base prompt', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      systemOverride: 'Custom system prompt',
    };

    const gen = runReActLoop(opts, baseMockDeps());
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(mockLlm.completeStream).toHaveBeenCalled();
    const lastCall = (mockLlm.completeStream as any).mock?.calls?.[0]?.[0];
    expect(lastCall?.system).toBe('Custom system prompt');
  });

  it('should respect abortSignal to terminate early', async () => {
    const controller = new AbortController();

    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: new Promise((r) =>
          setTimeout(() => r(Result.ok({ content: 'Response', toolCalls: [] })), 100)
        ),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      abortSignal: controller.signal,
    };

    const gen = runReActLoop(opts, baseMockDeps({ maxSteps: 10 }));

    controller.abort();

    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    const errorEvent = events.find((e: any) => e._tag === 'Error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as any)?.error?.code).toBe('AGENT_ABORTED');
  });

  it('should support coreAllowlist to filter available tools', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      coreAllowlist: new Set(['allowed_tool']),
    };

    const gen = runReActLoop(opts, baseMockDeps());
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
  });

  it('should accept maxStepsOverride', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      maxStepsOverride: 5,
    };

    const gen = runReActLoop(opts, baseMockDeps({ maxSteps: 100 }));
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    const stepEvents = events.filter((e: any) => e._tag === 'Step');
    expect(stepEvents.some((e: any) => e.max === 5)).toBe(true);
  });

  it('should support approvalOverride', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const mockApproval = {
      evaluate: () => Effect.succeed({ decision: 'allow' }),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      approvalOverride: mockApproval as any,
    };

    const gen = runReActLoop(opts, baseMockDeps());
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
  });

  it('should use maxStopContinuations from deps when opts does not override', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: 'Done', toolCalls: [] })),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      // maxStopContinuations not set in opts 鈫?should use deps value
    };

    const gen = runReActLoop(opts, baseMockDeps({ maxStopContinuations: 5 }));
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
  });

  it('should emit turn hooks', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
    };

    const gen = runReActLoop(opts, baseMockDeps());
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(mockHooks.emit).toHaveBeenCalledWith(
      'agent.turn.start',
      expect.objectContaining({ sessionId: mockState.sessionId })
    );
    expect(mockHooks.emit).toHaveBeenCalledWith(
      'agent.turn.end',
      expect.objectContaining({ status: 'done' })
    );
  });
});
