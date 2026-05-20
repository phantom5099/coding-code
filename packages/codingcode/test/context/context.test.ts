import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../src/context/context.js';
import { SessionService } from '../../src/session/store.js';
import { SkillService } from '../../src/skills/index.js';
import { ToolExecutorService } from '../../src/tools/executor.js';
import type { SessionStoreState } from '../../src/session/store.js';
import { sendMessage } from '../../src/orchestrate.js';
import { Result } from '../../src/core/result.js';

const mockState: SessionStoreState = {
  sessionId: 'test-session', cwd: '/tmp/test', projectSlug: 'test',
  transcriptPath: '/tmp/test.jsonl', indexPath: '/tmp/test.index.json',
  messageCount: 0, sessionMeta: null, title: 'test-sess',
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
}));

function makeMockSessionLayer(state: SessionStoreState) {
  return Layer.succeed(SessionService, SessionService.of({
    _tag: 'Session' as const,
    create: () => Effect.succeed(state),
    recordUser: () => Effect.succeed({ type: 'user' as const, uuid: 'u1', content: '', timestamp: new Date().toISOString() }),
    recordAssistant: () => Effect.succeed({ type: 'assistant' as const, uuid: 'a1', content: '', toolCalls: [], model: 'test', timestamp: new Date().toISOString() }),
    recordToolResult: () => Effect.succeed({ type: 'tool_result' as const, uuid: 't1', parentUuid: 'a1', toolName: 'test', toolCallId: 'tc1', output: '', timestamp: new Date().toISOString() }),
    recordCompactBoundary: () => Effect.succeed({ type: 'compact_boundary' as const, uuid: 'c1', summary: '', replacedRange: [0, 0] as [number, number], messageCount: 0, timestamp: new Date().toISOString() }),
    readHistory: () => Effect.succeed([]),
    readMessages: () => Effect.succeed(state.sessionId === 'full-flow' ? [
      { role: 'user', content: 'message one' },
    ] : []),
    listSessions: () => Effect.succeed([]),
    getSessionId: () => state.sessionId,
    getMessageCount: () => 0,
  }));
}

describe('ContextService', () => {
  it('should add user message and assistant response', async () => {
    const sid = 'test-flow';
    const layer = makeMockSessionLayer({ ...mockState, sessionId: sid });
    const { ContextLayer } = await import('../../src/layer.js');
    const fullLayer = Layer.mergeAll(layer, ContextLayer);

    const program = Effect.gen(function* () {
      const ctx = yield* ContextService;
      yield* ctx.addUser(sid, 'msg1');
      yield* ctx.addAssistant(sid, 'resp1', []);
      const msgs = yield* ctx.getMessages(sid);
      return msgs;
    }) as any;

    const msgs = await Effect.runPromise(program.pipe(Effect.provide(fullLayer) as any));
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('user');
    expect(msgs[0]!.content).toBe('msg1');
    expect(msgs[1]!.role).toBe('assistant');
    expect(msgs[1]!.content).toBe('resp1');
  });

  it('should retain context across multiple add calls', async () => {
    const sid = 'multi-add';
    const layer = makeMockSessionLayer({ ...mockState, sessionId: sid });
    const { ContextLayer } = await import('../../src/layer.js');
    const fullLayer = Layer.mergeAll(layer, ContextLayer);

    const program = Effect.gen(function* () {
      const ctx = yield* ContextService;
      yield* ctx.clear(sid);
      yield* ctx.addUser(sid, 'new-1');
      yield* ctx.addUser(sid, 'new-2');
      return yield* ctx.getMessages(sid);
    }) as any;

    const msgs2 = await Effect.runPromise(program.pipe(Effect.provide(fullLayer) as any));
    expect(msgs2).toHaveLength(2);
    expect(msgs2[0]!.content).toBe('new-1');
    expect(msgs2[1]!.content).toBe('new-2');
  });

  it('should retain context when sendMessage and resumeSession run in separate Effect scopes', async () => {
    const sid = 'full-flow';

    const mockSessionLayer = makeMockSessionLayer({ ...mockState, sessionId: sid });
    const { AgentService } = await import('../../src/agent/agent.js');
    const { ContextLayer } = await import('../../src/layer.js');

    const MockSkillLayer = Layer.succeed(SkillService, SkillService.of({
      _tag: 'Skill' as const,
      loadAll: () => Effect.succeed(undefined), getAll: () => Effect.succeed([]),
      findByName: () => Effect.succeed(undefined), select: () => Effect.succeed(undefined),
      selectImplicit: () => Effect.succeed(undefined), extractSkill: (_input: string) => Effect.succeed([undefined, _input] as [undefined, string]),
    }));

    const { ToolLayer, HookLayer } = await import('../../src/layer.js');
    const AgentDeps = Layer.mergeAll(MockToolExecutorLayer, ToolLayer);
    const TestAgentLayer = AgentService.Default.pipe(Layer.provide(AgentDeps));
    const fullLayer = Layer.mergeAll(mockSessionLayer, MockSkillLayer, TestAgentLayer, ContextLayer, HookLayer);

    // Step 1: send message in one Effect scope
    {
      const program = sendMessage({ ...mockState, sessionId: sid }, 'message one', mockLlm);
      const gen: any = await Effect.runPromise((program as any).pipe(Effect.provide(fullLayer) as any));
      const chunks: string[] = [];
      for await (const chunk of gen) chunks.push(chunk);
    }

    // Step 2: verify context persisted across Effect scopes
    const g3 = Effect.gen(function* () {
      const ctx = yield* ContextService;
      return yield* ctx.getMessages(sid);
    }) as any;
    const msgs3 = await Effect.runPromise(g3.pipe(Effect.provide(ContextLayer) as any)) as Array<{ role: string; content: string }>;

    expect(msgs3.length).toBeGreaterThanOrEqual(1);
    expect(msgs3.some((m: any) => m.role === 'user' && m.content === 'message one')).toBe(true);
  });
});
