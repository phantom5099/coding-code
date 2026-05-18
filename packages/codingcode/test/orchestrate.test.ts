import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { sendMessage } from './orchestrate.js';
import { SessionService, type SessionStoreState } from './session/store.js';
import { SkillService } from './skills/index.js';
import { Result } from './core/result.js';

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

const MockSessionLayer = Layer.succeed(SessionService, SessionService.of({
  _tag: 'Session' as const,
  create: () => Effect.succeed(mockState),
  recordUser: () => Effect.succeed({ type: 'user' as const, uuid: 'u1', content: '', timestamp: new Date().toISOString() }),
  recordAssistant: () => Effect.succeed({ type: 'assistant' as const, uuid: 'a1', content: '', toolCalls: [], model: 'test', timestamp: new Date().toISOString() }),
  recordToolResult: () => Effect.succeed({ type: 'tool_result' as const, uuid: 't1', parentUuid: 'a1', toolName: 'test', toolCallId: 'tc1', output: '', timestamp: new Date().toISOString() }),
  recordRoleSwitch: () => Effect.succeed({ type: 'role_switch' as const, uuid: 'r1', fromRole: 'a', toRole: 'b', timestamp: new Date().toISOString() }),
  recordCompactBoundary: () => Effect.succeed({ type: 'compact_boundary' as const, uuid: 'c1', summary: '', replacedRange: [0, 0] as [number, number], messageCount: 0, timestamp: new Date().toISOString() }),
  readHistory: () => Effect.succeed([]), readMessages: () => Effect.succeed([]), listSessions: () => Effect.succeed([]),
  getSessionId: () => 'test', getMessageCount: () => 0,
}));

const MockSkillLayer = Layer.succeed(SkillService, SkillService.of({
  _tag: 'Skill' as const,
  loadAll: () => Effect.succeed(undefined), getAll: () => Effect.succeed([]),
  findByName: () => Effect.succeed(undefined), select: () => Effect.succeed(undefined),
  selectImplicit: () => Effect.succeed(undefined), extractSkill: () => Effect.succeed([undefined, 'hi']),
}));

const { AgentLayer, ContextLayer } = await import('./layer.js');
const TestLayer = Layer.mergeAll(MockSessionLayer, MockSkillLayer, AgentLayer, ContextLayer);

describe('sendMessage stream', () => {
  it('should yield text chunks from LLM', async () => {
    const program = sendMessage(mockState, 'hi', mockLlm, mockExecutor, {});
    const generator: any = await Effect.runPromise(program.pipe(Effect.provide(TestLayer) as any));

    const chunks: string[] = [];
    for await (const chunk of generator) chunks.push(chunk);

    expect(chunks).toContain('Hello');
    expect(chunks).toContain(' ');
    expect(chunks).toContain('world');
  });

  it('should not return empty stream for normal LLM response', async () => {
    const program = sendMessage(mockState, 'hi', mockLlm, mockExecutor, {});
    const generator: any = await Effect.runPromise(program.pipe(Effect.provide(TestLayer) as any));

    const chunks: string[] = [];
    for await (const chunk of generator) chunks.push(chunk);

    expect(chunks.length).toBeGreaterThan(0);
  });
});
