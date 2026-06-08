import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from '../../src/agent/agent.js';
import { Result } from '../../src/core/result.js';
import { HookService } from '../../src/hooks/registry.js';

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

const mockState = {
  sessionId: 'cache-test-sid',
  cwd: '/tmp/cache-test',
  projectPath: 'cache-test',
  transcriptPath: '/tmp/cache-test.jsonl',
  indexPath: '/tmp/cache-test.index.json',
  messageCount: 0,
  currentTurnId: 1,
  sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
  title: 'cache-test',
  usage: undefined,
  promptEstimate: 0,
  memorySnapshot: '',
};

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
  const captured: { system?: string } = {};
  const llm = {
    completeStream: (params: any) => {
      captured.system = params.system;
      return {
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: '' })),
      };
    },
    modelInfo: { maxTokens: 1000 },
  } as any;
  return { llm, captured };
}

async function runOnce(llm: any) {
  const gen = runReActLoop({ state: mockState, llm }, makeDeps());
  for await (const _event of gen) {
    // drain
  }
}

describe('LLM prompt cache stability', () => {
  it('system prompt does not include deferred tools catalog', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm);
    expect(captured.system).toBeDefined();
    // buildDeferredCatalogContent emits an <available-deferred-tools>...</available-deferred-tools>
    // block with the list of unloaded deferred tools. Since we removed the call, this block must
    // not appear in the system prompt.
    expect(captured.system).not.toContain('<available-deferred-tools>');
    expect(captured.system).not.toContain('</available-deferred-tools>');
  });

  it('system prompt is byte-identical across consecutive turns', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm);
    const first = captured.system;
    expect(first).toBeDefined();
    await runOnce(llm);
    const second = captured.system;
    expect(second).toBe(first);
  });
});
