import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { sendMessage } from '../src/orchestration/index.js';
import { SessionService } from '../src/session/store.js';
import { SkillService } from '../src/skills/index.js';
import { ToolExecutorService } from '../src/tools/executor.js';
import { Result } from '../src/core/result.js';

const mockState = {
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

const MockSessionLayer = Layer.succeed(SessionService, SessionService.of({
  _tag: 'Session' as const,
  create: () => Effect.succeed(mockState),
  recordUser: () => Effect.succeed({ type: 'user' as const, uuid: 'u1', content: '', timestamp: new Date().toISOString() }),
  recordAssistant: () => Effect.succeed({ type: 'assistant' as const, uuid: 'a1', content: '', toolCalls: [], model: 'test', timestamp: new Date().toISOString() }),
  recordToolResult: () => Effect.succeed({ type: 'tool_result' as const, uuid: 't1', parentUuid: 'a1', toolName: 'test', toolCallId: 'tc1', output: '', timestamp: new Date().toISOString() }),
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

const { AgentService } = await import('../src/agent/agent.js');
const { ContextLayer, ToolLayer, HookLayer } = await import('../src/layer.js');
const AgentDeps = Layer.mergeAll(MockToolExecutorLayer, ToolLayer);
const TestAgentLayer = AgentService.Default.pipe(Layer.provide(AgentDeps));
const TestLayer = Layer.mergeAll(MockSessionLayer, MockSkillLayer, TestAgentLayer, ContextLayer, HookLayer);

describe('sendMessage stream', () => {
  it('should yield AgentEvent chunks from LLM', async () => {
    const program = sendMessage('test-session', 'hi', '/tmp/test', mockLlm);
    const { stream } = await Effect.runPromise(program.pipe(Effect.provide(TestLayer) as any)) as any;

    const events: any[] = [];
    for await (const event of stream) events.push(event);

    const textChunks = events
      .filter((e: any) => e._tag === 'LlmChunk')
      .map((e: any) => e.text);
    expect(textChunks).toContain('Hello');
    expect(textChunks).toContain(' ');
    expect(textChunks).toContain('world');
  });

  it('should not return empty event stream for normal LLM response', async () => {
    const program = sendMessage('test-session', 'hi', '/tmp/test', mockLlm);
    const { stream } = await Effect.runPromise(program.pipe(Effect.provide(TestLayer) as any)) as any;

    const events: any[] = [];
    for await (const event of stream) events.push(event);

    expect(events.length).toBeGreaterThan(0);
  });
});
