import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../src/context/context.js';
import { SessionService } from '../../src/session/store.js';
import { SkillService } from '../../src/skills/index.js';
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

const mockExecutor = {
  execute: (_name: string, _args: Record<string, unknown>, _opts?: any) => Effect.succeed('done'),
  getRegistry: () => ({ describeAll: () => [], filter: () => [] }),
};

function makeMockSessionLayer(state: SessionStoreState) {
  return Layer.succeed(SessionService, SessionService.of({
    _tag: 'Session' as const,
    create: () => Effect.succeed(state),
    recordUser: () => Effect.succeed({ type: 'user' as const, uuid: 'u1', content: '', timestamp: new Date().toISOString() }),
    recordAssistant: () => Effect.succeed({ type: 'assistant' as const, uuid: 'a1', content: '', toolCalls: [], model: 'test', timestamp: new Date().toISOString() }),
    recordToolResult: () => Effect.succeed({ type: 'tool_result' as const, uuid: 't1', parentUuid: 'a1', toolName: 'test', toolCallId: 'tc1', output: '', timestamp: new Date().toISOString() }),
    recordCompactBoundary: () => Effect.succeed({ type: 'compact_boundary' as const, uuid: 'c1', summary: '', replacedRange: [0, 0] as [number, number], messageCount: 0, timestamp: new Date().toISOString() }),
    readHistory: () => Effect.succeed([]), readMessages: () => Effect.succeed([]), listSessions: () => Effect.succeed([]),
    getSessionId: () => state.sessionId, getMessageCount: () => 0,
  }));
}

const { ContextLayer } = await import('../../src/layer.js');

describe('ContextService cross-request persistence', () => {
  it('should retain messages across separate Effect.runPromise calls', async () => {
    const sid = 'persist-test';

    // First "request": add messages
    await Effect.runPromise(
      Effect.gen(function* () {
        const ctx = yield* ContextService;
        yield* ctx.addUser(sid, 'hello world');
        yield* ctx.addAssistant(sid, 'assistant response');
      }).pipe(Effect.provide(ContextLayer) as any),
    );

    // Second "request": messages should still be there
    const gen = Effect.gen(function* () {
      const ctx = yield* ContextService;
      return yield* ctx.getMessages(sid);
    });
    const msgs = await Effect.runPromise(gen.pipe(Effect.provide(ContextLayer) as any)) as Array<{ role: string; content: string }>;

    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'hello world' });
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: 'assistant response' });
  });

  it('should isolate messages between different sessions', async () => {
    const sidA = 'session-a';
    const sidB = 'session-b';

    await Effect.runPromise(
      Effect.gen(function* () {
        const ctx = yield* ContextService;
        yield* ctx.addUser(sidA, 'message for A');
      }).pipe(Effect.provide(ContextLayer) as any),
    );

    const genB = Effect.gen(function* () {
      const ctx = yield* ContextService;
      return yield* ctx.getMessages(sidB);
    });
    const msgsB = await Effect.runPromise(genB.pipe(Effect.provide(ContextLayer) as any)) as Array<{ role: string; content: string }>;

    expect(msgsB).toHaveLength(0);
  });

  it('clear() should delete messages for the given session', async () => {
    const sid = 'clear-test';

    await Effect.runPromise(
      Effect.gen(function* () {
        const ctx = yield* ContextService;
        yield* ctx.addUser(sid, 'before');
      }).pipe(Effect.provide(ContextLayer) as any),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const ctx = yield* ContextService;
        yield* ctx.clear(sid);
      }).pipe(Effect.provide(ContextLayer) as any),
    );

    const g1 = Effect.gen(function* () {
      const ctx = yield* ContextService;
      return yield* ctx.getMessages(sid);
    });
    const msgs = await Effect.runPromise(g1.pipe(Effect.provide(ContextLayer) as any)) as Array<{ role: string; content: string }>;

    expect(msgs).toHaveLength(0);
  });

  it('setMessages should replace messages for the given session', async () => {
    const sid = 'set-test';

    await Effect.runPromise(
      Effect.gen(function* () {
        const ctx = yield* ContextService;
        yield* ctx.addUser(sid, 'old');
      }).pipe(Effect.provide(ContextLayer) as any),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const ctx = yield* ContextService;
        yield* ctx.setMessages(sid, [
          { role: 'user', content: 'new-1' },
          { role: 'assistant', content: 'new-2' },
        ]);
      }).pipe(Effect.provide(ContextLayer) as any),
    );

    const g2 = Effect.gen(function* () {
      const ctx = yield* ContextService;
      return yield* ctx.getMessages(sid);
    });
    const msgs2 = await Effect.runPromise(g2.pipe(Effect.provide(ContextLayer) as any)) as Array<{ role: string; content: string }>;

    expect(msgs2).toHaveLength(2);
    expect(msgs2[0]!.content).toBe('new-1');
    expect(msgs2[1]!.content).toBe('new-2');
  });

  it('should retain context when sendMessage and resumeSession run in separate Effect scopes', async () => {
    const sid = 'full-flow';

    const mockSessionLayer = makeMockSessionLayer({ ...mockState, sessionId: sid });
    const { AgentLayer } = await import('../../src/layer.js');

    const MockSkillLayer = Layer.succeed(SkillService, SkillService.of({
      _tag: 'Skill' as const,
      loadAll: () => Effect.succeed(undefined), getAll: () => Effect.succeed([]),
      findByName: () => Effect.succeed(undefined), select: () => Effect.succeed(undefined),
      selectImplicit: () => Effect.succeed(undefined), extractSkill: (_input: string) => Effect.succeed([undefined, _input] as [undefined, string]),
    }));

    const fullLayer = Layer.mergeAll(mockSessionLayer, MockSkillLayer, AgentLayer, ContextLayer);

    // Step 1: send message in one Effect scope
    {
      const program = sendMessage({ ...mockState, sessionId: sid }, 'message one', mockLlm, mockExecutor, {});
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
