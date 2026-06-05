import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from '../../src/agent/agent.js';
import { HookService } from '../../src/hooks/registry.js';
import { Result } from '../../src/core/result.js';

const mockToolRegistry = {
  describeAll: () => [],
  filter: () => [],
  get: () => null,
  register: () => Effect.succeed(undefined),
  allCore: () => [],
  allDeferred: () => [],
  getDef: () => undefined,
};

const mockToolSearch = {
  isLoaded: () => false,
  listLoaded: () => [],
  listUnloadedDeferred: () => [],
  search: () => [],
  reset: () => {},
};

const mockAgentService = {
  runStream: () => {
    throw new Error('not implemented');
  },
};

const mockCtx = {
  build: () =>
    Effect.sync(() => ({ messages: [{ role: 'user' as const, content: 'hi' }], newBudgets: [] })),
  appendTurnEnd: () => Effect.succeed({ didCompress: false, released: 0 }),
};

const mockSession = {
  recordAssistant: () => Effect.sync(() => ({ uuid: 'a1' })),
  recordToolResult: () => Effect.sync(() => ({})),
};

const mockCheckpoint = {
  snapshotFinal: () => {},
};

const mockState = {
  sessionId: 'type-test',
  cwd: '/tmp',
  projectPath: 'test',
  transcriptPath: '/tmp/test.jsonl',
  indexPath: '/tmp/test.index.json',
  messageCount: 0,
  currentTurnId: 1,
  sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
  title: 'type-test',
  usage: undefined,
  promptEstimate: 0,
};

describe('RunReActDeps hooks type', () => {
  it('should accept a properly typed HookService mock', async () => {
    const mockHooks = {
      emit: (_point: any, _payload: any) => Effect.succeed(undefined),
      emitDecision: (_point: any, _payload: any) => Effect.succeed(null),
      register: (_point: any, _handler: any, _opts?: any) => Effect.succeed(() => {}),
      registerDecision: (_point: any, _handler: any, _opts?: any) => Effect.succeed(() => {}),
      reloadUserHooks: (_cwd: string) => Effect.succeed(undefined),
    } as unknown as HookService;

    const mockLlm = {
      completeStream: () => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: '' })),
      }),
    };

    const deps = {
      maxSteps: 1,
      maxStopContinuations: 2,
      executor: null as any,
      runtime: { listAgentProfiles: () => [] } as any,
      toolSearch: mockToolSearch as any,
      agentService: mockAgentService as any,
      ctx: mockCtx as any,
      session: mockSession as any,
      checkpoint: mockCheckpoint as any,
      hooks: mockHooks,
    };

    const gen = runReActLoop(
      { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any },
      deps
    );

    const result = await gen.next();
    expect(result.done).toBe(false);
  });
});
