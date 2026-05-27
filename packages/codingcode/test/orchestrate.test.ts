import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { sendMessage } from '../src/agent/agent.js';
import { SessionService } from '../src/session/store.js';
import { ContextService } from '../src/context/context.js';
import { SkillService } from '../src/skills/index.js';
import { ToolExecutorService } from '../src/tools/executor.js';
import { CheckpointService } from '../src/checkpoint/checkpoint-service.js';
import { Result } from '../src/core/result.js';
import { McpService } from '../src/mcp/index.js';
import { ToolSearchService } from '../src/tools/tool-search-service.js';

const mockState = {
  sessionId: 'test-session', cwd: '/tmp/test', projectPath: 'test',
  transcriptPath: '/tmp/test.jsonl', indexPath: '/tmp/test.index.json',
  messageCount: 0, currentTurnId: 0, sessionMeta: null, title: 'test-sess',
  tokenCountEstimate: 0,
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

const MockSessionLayer = Layer.succeed(SessionService, SessionService.of({
  _tag: 'Session' as const,
  create: () => Effect.succeed(mockState),
  recordUser: () => Effect.succeed({ type: 'user' as const, uuid: 'u1', content: '', turnId: 0, timestamp: new Date().toISOString() }),
  recordAssistant: () => Effect.succeed({ type: 'assistant' as const, uuid: 'a1', content: '', toolCalls: [] as any, model: 'test', turnId: 0, timestamp: new Date().toISOString() }),
  recordToolResult: () => Effect.succeed({ type: 'tool_result' as const, uuid: 't1', parentUuid: 'a1', toolName: 'test', toolCallId: 'tc1', output: '', turnId: 0, timestamp: new Date().toISOString(), tokenCount: 0 }),
  readHistory: () => Effect.succeed([]), readMessages: () => Effect.succeed([]), listSessions: () => Effect.succeed([]),
  getSessionId: () => 'test', getMessageCount: () => 0,
  incrementTurn: () => 0,
  findSessionIndex: () => Effect.succeed(null),
}));

const MockContextLayer = Layer.succeed(ContextService, ContextService.of({
  _tag: 'Context' as any,
  build: () => Effect.sync(() => [{ role: 'user' as const, content: 'hi' }]),
  compress: () => Effect.succeed({ didCompress: true, released: 0 }),
  appendTurnEnd: () => Effect.succeed({ didCompress: false, released: 0 }),
}));

const MockSkillLayer = Layer.succeed(SkillService, SkillService.of({
  _tag: 'Skill' as const,
  loadAll: () => Effect.succeed(undefined), getAll: () => Effect.succeed([]),
  findByName: () => Effect.succeed(undefined), select: () => Effect.succeed(undefined),
  selectImplicit: () => Effect.succeed(undefined), extractSkill: () => Effect.succeed([undefined, 'hi']),
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

const { AgentService } = await import('../src/agent/agent.js');
const { ToolLayer, HookLayer } = await import('../src/layer.js');

const MockMcpLayer = Layer.succeed(McpService, {
  syncConnections: (_: string) => Effect.void,
  status: () => Effect.succeed([]),
} as any);

const MockToolSearchLayer = Layer.succeed(ToolSearchService, ToolSearchService.of({
  _tag: 'ToolSearchService' as const,
  isLoaded: () => false,
  listLoaded: () => [],
  listUnloadedDeferred: () => [],
  search: () => [],
  reset: () => {},
}));

const AllDeps = Layer.mergeAll(
  MockToolExecutorLayer,
  ToolLayer,
  MockContextLayer,
  MockSessionLayer,
  MockCheckpointLayer,
  MockSkillLayer,
  HookLayer,
  MockMcpLayer,
  MockToolSearchLayer,
);

const TestLayer = Layer.mergeAll(
  AgentService.Default.pipe(Layer.provide(AllDeps)),
  AllDeps,
);

describe('sendMessage stream', () => {
  it('should yield AgentEvent chunks from LLM', async () => {
    const program = sendMessage(undefined, 'hi', '/tmp/test', mockLlm);
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
    const program = sendMessage(undefined, 'hi', '/tmp/test', mockLlm);
    const { stream } = await Effect.runPromise(program.pipe(Effect.provide(TestLayer) as any)) as any;

    const events: any[] = [];
    for await (const event of stream) events.push(event);

    expect(events.length).toBeGreaterThan(0);
  });
});
