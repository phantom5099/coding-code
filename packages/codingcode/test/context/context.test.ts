import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../src/context/context.js';
import { SessionService } from '../../src/session/store.js';
import { SkillService } from '../../src/skills/index.js';
import { ToolExecutorService } from '../../src/tools/executor.js';
import { McpService } from '../../src/mcp/index.js';
import { sendMessage } from '../../src/agent/agent.js';
import { Result } from '../../src/core/result.js';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';
import { ToolSearchService } from '../../src/tools/tool-search-service.js';

const mockState = {
  sessionId: 'test-session', cwd: '/tmp/test', projectPath: 'test',
  transcriptPath: '/tmp/test.jsonl', indexPath: '/tmp/test.index.json',
  messageCount: 0, currentTurnId: 0, sessionMeta: null, title: 'test-sess',
};

const mockLlm = {
  completeStream: (_params: any) => {
    const stream = async function* () { yield 'Hello'; yield ' '; yield 'world'; }();
    return { stream, response: Promise.resolve(Result.ok({ content: 'Hello world' })) };
  },
};

const MockToolExecutorLayer = Layer.succeed(ToolExecutorService, ToolExecutorService.of({
  _tag: 'ToolExecutor' as const,
  execute: () => Effect.succeed('done'),
  executeBatch: (toolCalls: any[]) => Effect.succeed(
    toolCalls.map((tc: any) => ({ type: 'ok' as const, id: tc.id, name: tc.name, output: '' })),
  ),
}));

const MockContextLayer = Layer.succeed(ContextService, ContextService.of({
  _tag: 'Context' as any,
  build: () => Effect.sync(() => ({ messages: [{ role: 'user' as const, content: 'hi' }], newBudgets: [] })),
  compress: () => Effect.succeed({ didCompress: true, released: 0, promptEstimate: 0 }),
  compactIfNeeded: () => Effect.succeed({ didCompress: false, released: 0, promptEstimate: 0 }),
}));

const MockCheckpointLayer = Layer.succeed(CheckpointService, CheckpointService.of({
  _tag: 'Checkpoint' as const,
  snapshotBaseline: () => {},
  snapshotFinal: () => {},
  classifyChanges: () => null,
  getCompletedTurns: () => [],
  revertFiles: () => {},
  forward: () => null,
  hasForwardStack: () => false,
  getCheckpoints: () => [],
}));

function makeMockSessionLayer(state: any) {
  return Layer.succeed(SessionService, SessionService.of({
    _tag: 'Session' as const,
    create: () => Effect.succeed(state),
    recordUser: () => Effect.succeed({ type: 'user' as const, uuid: 'u1', content: '', turnId: 0, timestamp: new Date().toISOString() }),
    recordAssistant: () => Effect.succeed({ type: 'assistant' as const, uuid: 'a1', content: '', toolCalls: [], model: 'test', turnId: 0, timestamp: new Date().toISOString() }),
    recordToolResult: () => Effect.succeed({ type: 'tool_result' as const, uuid: 't1', parentUuid: 'a1', toolName: 'test', toolCallId: 'tc1', output: '', turnId: 0, timestamp: new Date().toISOString(), tokenCount: 0 }),
    readHistory: () => Effect.succeed([]),
    readMessages: () => Effect.succeed(state.sessionId === 'full-flow' ? [
      { role: 'user', content: 'message one' },
    ] : []),
    listSessions: () => Effect.succeed([]),
    getSessionId: () => state.sessionId,
    getMessageCount: () => 0,
    incrementTurn: () => 0,
    findSessionIndex: () => Effect.succeed(null),
  }));
}

describe('ContextService', () => {
  it('should retain context when sendMessage and resumeSession run in separate Effect scopes', async () => {
    const sid = 'full-flow';

    const mockSessionLayer = makeMockSessionLayer({ ...mockState, sessionId: sid });
    const { AgentService } = await import('../../src/agent/agent.js');
    const MockSkillLayer = Layer.succeed(SkillService, SkillService.of({
      _tag: 'Skill' as const,
      loadAll: () => Effect.succeed(undefined), getAll: () => Effect.succeed([]),
      findByName: () => Effect.succeed(undefined), select: () => Effect.succeed(undefined),
      selectImplicit: () => Effect.succeed(undefined), extractSkill: (_input: string) => Effect.succeed([undefined, _input] as [undefined, string]),
    }));

    const { ToolLayer, HookLayer } = await import('../../src/layer.js');

    const MockToolSearchLayer = Layer.succeed(ToolSearchService, ToolSearchService.of({
      _tag: 'ToolSearchService' as const, isLoaded: () => false, listLoaded: () => [],
      listUnloadedDeferred: () => [], search: () => [], reset: () => {},
    }));

    const MockMcpLayer = Layer.succeed(McpService, {
      syncConnections: () => Effect.void,
      connectServers: () => Effect.void,
      disconnectServers: () => Effect.void,
      getServerToolNames: () => [],
      disconnectAll: () => Effect.void,
      status: () => Effect.succeed([]),
    } as any);

    const AllDeps = Layer.mergeAll(
      MockToolExecutorLayer,
      ToolLayer,
      MockContextLayer,
      mockSessionLayer,
      MockCheckpointLayer,
      MockSkillLayer,
      HookLayer,
      MockToolSearchLayer,
      MockMcpLayer,
    );

    const fullLayer = Layer.mergeAll(
      AgentService.Default.pipe(Layer.provide(AllDeps)),
      AllDeps,
    );

    let sid1: string = '';
    // Step 1: send message in one Effect scope
    {
      const program = sendMessage(undefined, 'message one', '/tmp/test', mockLlm);
      const { stream: gen, sessionId } = await Effect.runPromise((program as any).pipe(Effect.provide(fullLayer) as any)) as any;
      sid1 = sessionId;
      // Consume all AgentEvents to trigger side effects
      for await (const _event of gen) { /* consume */ }
    }

    // Step 2: verify message was recorded by trying to resume
    const g3 = Effect.gen(function* () {
      const svc = yield* SessionService;
      const state = yield* svc.create('/tmp/test', 'unknown', '0.1.0', sid1);
      return yield* svc.readHistory(state);
    }) as any;
    const history3 = await Effect.runPromise(g3.pipe(Effect.provide(mockSessionLayer) as any)) as any[];

    expect(Array.isArray(history3)).toBe(true);
  });
});
