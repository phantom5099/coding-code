import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { sseHandler } from '../../src/server/handler.js';
import { sendMessage } from '../../src/orchestration/index.js';
import { toSSEString } from '../../src/server/adapter.js';
import { SessionService } from '../../src/session/store.js';
import { SkillService } from '../../src/skills/index.js';
import { ToolExecutorService } from '../../src/tools/executor.js';
import { Result } from '../../src/core/result.js';

const mockState = {
  sessionId: 'test-session',
  cwd: '/tmp/test',
  projectSlug: 'test',
  transcriptPath: '/tmp/test.jsonl',
  indexPath: '/tmp/test.index.json',
  messageCount: 0,
  sessionMeta: null,
  title: 'test-sess',
};

function createMockLlm(chunks?: string[], responseContent?: string) {
  return {
    completeStream: (_params: any) => ({
      stream: (async function* () {
        for (const c of chunks ?? []) yield c;
      })(),
      response: Promise.resolve(
        Result.ok({ content: responseContent ?? chunks?.join('') ?? '' }),
      ),
    }),
  };
}

const MockToolExecutorLayer = Layer.succeed(ToolExecutorService, ToolExecutorService.of({
  _tag: 'ToolExecutor' as const,
  execute: () => Effect.succeed('done'),
}));

const MockSessionLayer = Layer.succeed(
  SessionService,
  SessionService.of({
    _tag: 'Session' as const,
    create: () => Effect.succeed(mockState),
    recordUser: () =>
      Effect.succeed({ type: 'user' as const, uuid: 'u1', content: '', timestamp: new Date().toISOString() }),
    recordAssistant: () =>
      Effect.succeed({ type: 'assistant' as const, uuid: 'a1', content: '', toolCalls: [], model: 'test', timestamp: new Date().toISOString() }),
    recordToolResult: () =>
      Effect.succeed({ type: 'tool_result' as const, uuid: 't1', parentUuid: 'a1', toolName: 'test', toolCallId: 'tc1', output: '', timestamp: new Date().toISOString() }),
    recordCompactBoundary: () =>
      Effect.succeed({ type: 'compact_boundary' as const, uuid: 'c1', summary: '', replacedRange: [0, 0] as [number, number], messageCount: 0, timestamp: new Date().toISOString() }),
    readHistory: () => Effect.succeed([]),
    readMessages: () => Effect.succeed([]),
    listSessions: () => Effect.succeed([]),
    getSessionId: () => 'test',
    getMessageCount: () => 0,
  }),
);

const MockSkillLayer = Layer.succeed(
  SkillService,
  SkillService.of({
    _tag: 'Skill' as const,
    loadAll: () => Effect.succeed(undefined),
    getAll: () => Effect.succeed([]),
    findByName: () => Effect.succeed(undefined),
    select: () => Effect.succeed(undefined),
    selectImplicit: () => Effect.succeed(undefined),
    extractSkill: () => Effect.succeed([undefined, 'hi']),
  }),
);

const { AgentService } = await import('../../src/agent/agent.js');
const { ContextLayer, ToolLayer, HookLayer } = await import('../../src/layer.js');
const AgentDeps = Layer.mergeAll(MockToolExecutorLayer, ToolLayer);
const TestAgentLayer = AgentService.Default.pipe(Layer.provide(AgentDeps));

const TestLayer = Layer.mergeAll(
  MockSessionLayer,
  MockSkillLayer,
  TestAgentLayer,
  ContextLayer,
  HookLayer,
);


async function readSSEStream(response: Response): Promise<{ events: any[] }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();

  const events: any[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(JSON.parse(line.slice(6)));
    }
  }
  return { events };
}

describe('sseHandler + sendMessage integration', () => {
  it('should stream text chunks and complete event', async () => {
    const llm = createMockLlm(['Hello', ' ', 'world']);
    const program = sendMessage('test-session', 'hi', '/tmp/test', llm) as any;
    const handler = sseHandler(async function* () {
      const { stream } = await Effect.runPromise(program.pipe(Effect.provide(TestLayer) as any)) as any;
      yield* toSSEString(stream);
    }, { sessionId: 'test' });
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    expect(events).toHaveLength(4); // 3 text + 1 complete
    expect(events[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(events[1]).toEqual({ type: 'text', text: ' ' });
    expect(events[2]).toEqual({ type: 'text', text: 'world' });
    expect(events[3]).toEqual({ type: 'complete' });
  });

  it('should send complete event even when LLM returns no text', async () => {
    const llm = createMockLlm([], '');
    const program = sendMessage('test-session', 'hi', '/tmp/test', llm) as any;
    const handler = sseHandler(async function* () {
      const { stream } = await Effect.runPromise(program.pipe(Effect.provide(TestLayer) as any)) as any;
      yield* toSSEString(stream);
    }, { sessionId: 'test' });
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    expect(events[events.length - 1]).toEqual({ type: 'complete' });
  });

  it('should forward [Using: ...] markers when LLM calls tools', async () => {
    const llm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield '\n[Using: readFile]\n';
        })(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'test.txt' } }],
          }),
        ),
      }),
    };

    const program = sendMessage('test-session', 'read file', '/tmp/test', llm) as any;
    const handler = sseHandler(async function* () {
      const { stream } = await Effect.runPromise(program.pipe(Effect.provide(TestLayer) as any)) as any;
      yield* toSSEString(stream);
    }, { sessionId: 'test' });
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    const textEvent = events.find((e: any) => e.type === 'text');
    expect(textEvent).toBeDefined();
    expect(textEvent!.text).toContain('[Using:');
  });

  it('should send error event when factory throws', async () => {
    const handler = sseHandler(async function* () {
      throw new Error('boom');
    }, { sessionId: 'test' });
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    expect(events.some((e: any) => e.type === 'error')).toBe(true);
  });
});
