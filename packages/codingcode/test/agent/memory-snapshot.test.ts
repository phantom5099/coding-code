import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { Result } from '../../src/core/result.js';
import { HookService } from '../../src/hooks/registry.js';

// Mock memory module before importing agent (which depends on it)
vi.mock('../../src/memory/index.js', () => ({
  loadMemoryForPrompt: vi.fn(),
  flushSessionToMemory: vi.fn().mockResolvedValue({ written: false, bytes: 0 }),
}));

// Import after mock is set up
import { runReActLoop } from '../../src/agent/agent.js';
import { loadMemoryForPrompt } from '../../src/memory/index.js';

const mockLoadMemoryForPrompt = vi.mocked(loadMemoryForPrompt);

const mockAgentService = {
  runStream: () => {
    throw new Error('not implemented');
  },
};

const mockCtx = {
  build: (_sessionId: string) =>
    Effect.sync(() => ({
      messages: [{ role: 'user' as const, content: 'hi' }],
      newBudgets: [],
      promptEstimate: 0,
    })),
  compactIfNeeded: () => Effect.succeed({ didCompress: false, released: 0, promptEstimate: 0 }),
};

const mockSession = {
  recordAssistant: (_state: any, _content: string, _toolCalls: any, _model: string) =>
    Effect.sync(() => ({ uuid: 'a1' })),
  recordToolResult: (
    _state: any,
    _parentUuid: string,
    _toolName: string,
    _toolCallId: string,
    _output: string
  ) => Effect.sync(() => ({})),
  recordUser: () => Effect.sync(() => ({})),
};

const mockCheckpoint = {
  snapshotFinal: () => {},
};

function makeState(memorySnapshot: string = '') {
  return {
    sessionId: 'memory-test-sid',
    cwd: '/tmp/memory-test',
    projectPath: 'memory-test',
    transcriptPath: '/tmp/memory-test.jsonl',
    indexPath: '/tmp/memory-test.index.json',
    messageCount: 0,
    currentTurnId: 1,
    sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
    title: 'memory-test',
    usage: undefined,
    promptEstimate: 0,
    memorySnapshot,
  };
}

function makeDeps(overrides?: Record<string, any>) {
  return {
    maxSteps: 1,
    maxStopContinuations: 0,
    executor: null as any,
    runtime: { listAgentProfiles: () => [] } as any,
    agentService: mockAgentService as any,
    ctx: mockCtx as any,
    session: mockSession as any,
    checkpoint: mockCheckpoint as any,
    hooks: {
      emit: () => Effect.succeed(undefined),
      emitDecision: () => Effect.succeed(null),
    } as unknown as HookService,
    ...overrides,
  };
}

function makeCapturingLlm() {
  const captured: { system?: string; messages?: any[] } = {};
  const llm = {
    completeStream: (params: any) => {
      captured.system = params.system;
      captured.messages = params.messages;
      return {
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: '' })),
      };
    },
    modelInfo: { maxTokens: 1000 },
  } as any;
  return { llm, captured };
}

async function runOnce(llm: any, memorySnapshot: string = '') {
  const state = makeState(memorySnapshot);
  const gen = runReActLoop({ state, llm }, makeDeps());
  for await (const _event of gen) {
    // drain
  }
  return state;
}

describe('Memory snapshot stability', () => {
  it('system prompt uses state.memorySnapshot instead of loadMemoryForPrompt', async () => {
    mockLoadMemoryForPrompt.mockReturnValue('## Long-term Memory\n\nNew content from disk');
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, '## Long-term Memory\n\nOriginal snapshot');
    expect(captured.system).toContain('Original snapshot');
    expect(captured.system).not.toContain('New content from disk');
  });

  it('system prompt is byte-identical across consecutive turns with same snapshot', async () => {
    mockLoadMemoryForPrompt.mockReturnValue('## Long-term Memory\n\nSame content');
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, '## Long-term Memory\n\nFrozen');
    const first = captured.system;
    expect(first).toBeDefined();
    await runOnce(llm, '## Long-term Memory\n\nFrozen');
    const second = captured.system;
    expect(second).toBe(first);
  });

  it('injects <system-reminder> when memory changed since snapshot', async () => {
    mockLoadMemoryForPrompt.mockReturnValue('## Long-term Memory\n\nUpdated on disk');
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, '## Long-term Memory\n\nOriginal snapshot');
    expect(captured.system).toContain('Original snapshot');
    const lastUserMsg = [...(captured.messages ?? [])]
      .reverse()
      .find((m: any) => m.role === 'user');
    expect(lastUserMsg).toBeDefined();
    expect(lastUserMsg.content).toContain('<system-reminder>');
    expect(lastUserMsg.content).toContain('Updated on disk');
  });

  it('does not inject <system-reminder> when memory matches snapshot', async () => {
    mockLoadMemoryForPrompt.mockReturnValue('## Long-term Memory\n\nSame');
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, '## Long-term Memory\n\nSame');
    const lastUserMsg = [...(captured.messages ?? [])]
      .reverse()
      .find((m: any) => m.role === 'user');
    expect(lastUserMsg).toBeDefined();
    expect(lastUserMsg.content).not.toContain('<system-reminder>');
  });

  it('does not inject <system-reminder> when both snapshot and current are empty', async () => {
    mockLoadMemoryForPrompt.mockReturnValue('');
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, '');
    const lastUserMsg = [...(captured.messages ?? [])]
      .reverse()
      .find((m: any) => m.role === 'user');
    expect(lastUserMsg).toBeDefined();
    expect(lastUserMsg.content).not.toContain('<system-reminder>');
  });
});
