import { expect, it, describe, vi } from 'vitest';
import { runReActLoop } from '../../src/agent/agent';
import { Result } from '../../src/core/result';
import type { RunStreamOptions } from '../../src/agent/agent';
import { randomUUID } from 'crypto';

describe('runReActLoop — loop options', () => {
  const mockState = {
    sessionId: 'test-session',
    cwd: process.cwd(),
    currentTurnId: randomUUID(),
    sessionMeta: { model: 'test-model', version: '0.1.0', createdAt: new Date().toISOString() } as any,
    title: 'test',
    tokenCountEstimate: 0,
  };

  const mockHooks = {
    emit: vi.fn(async () => {}),
    emitDecision: vi.fn(async () => null),
  };

  it('should accept systemOverride to replace base prompt', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          }),
        ),
      })),
    };

    const mockDeps = {
      maxSteps: 1,
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: {} as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {} as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: mockHooks,
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      systemOverride: 'Custom system prompt',
    };

    const gen = runReActLoop(opts, mockDeps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(mockLlm.completeStream).toHaveBeenCalled();
    const lastCall = mockLlm.completeStream.mock.calls[0]?.[0];
    expect(lastCall?.system).toBe('Custom system prompt');
  });

  it('should respect abortSignal to terminate early', async () => {
    const controller = new AbortController();

    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: new Promise(r => setTimeout(() => r(Result.ok({ content: 'Response', toolCalls: [] })), 100)),
      })),
    };

    const mockDeps = {
      maxSteps: 10,
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: {} as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {} as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: mockHooks,
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      abortSignal: controller.signal,
    };

    const gen = runReActLoop(opts, mockDeps);

    // Immediately abort
    controller.abort();

    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    // Should have error event for abort
    const errorEvent = events.find((e: any) => e._tag === 'Error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error?.code).toBe('AGENT_ABORTED');
  });

  it('should support coreAllowlist to filter available tools', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          }),
        ),
      })),
    };

    const mockToolRegistry = {
      getAll: () => [
        { name: 'allowed_tool', execute: async () => {} },
        { name: 'denied_tool', execute: async () => {} },
      ],
    };

    const mockDeps = {
      maxSteps: 1,
      executor: {} as any,
      toolRegistry: mockToolRegistry,
      toolSearch: {
        search: () => Promise.resolve([]),
      } as any,
      agentIdResolver: {} as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {} as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: mockHooks,
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      coreAllowlist: new Set(['allowed_tool']),
    };

    const gen = runReActLoop(opts, mockDeps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    // Should have called buildToolsForAgent with coreAllowlist
    // This is tested indirectly through the agent execution
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
          }),
        ),
      })),
    };

    const mockDeps = {
      maxSteps: 100, // default
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: {} as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {} as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: mockHooks,
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      maxStepsOverride: 5, // override to 5
    };

    const gen = runReActLoop(opts, mockDeps);
    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    // Check if Step events respect the override
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
          }),
        ),
      })),
    };

    const mockApproval = {
      evaluate: async () => ({ type: 'allow' as const }),
    };

    const mockDeps = {
      maxSteps: 1,
      executor: {} as any,
      toolRegistry: {} as any,
      toolSearch: {} as any,
      agentIdResolver: {} as any,
      ctx: {
        build: () => [],
        compress: async () => ({ released: 0 }),
        appendTurnEnd: async () => {},
      } as any,
      session: {} as any,
      checkpoint: {} as any,
      dedup: null,
      hooks: mockHooks,
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: mockLlm as any,
      approvalOverride: mockApproval as any,
    };

    const gen = runReActLoop(opts, mockDeps);
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
          }),
        ),
      })),
    };

    const mockDeps = {
      maxSteps: 1,
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
      hooks: mockHooks,
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

    // Check turn hooks were emitted
    expect(mockHooks.emit).toHaveBeenCalledWith(
      'agent.turn.start',
      expect.objectContaining({ sessionId: mockState.sessionId }),
    );
    expect(mockHooks.emit).toHaveBeenCalledWith(
      'agent.turn.end',
      expect.objectContaining({ status: 'done' }),
    );
  });
});
