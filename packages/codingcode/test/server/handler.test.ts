import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { sseHandler } from '../../src/server/handler.js';
import { sendMessage } from '../../src/agent/agent.js';
import { toSseEvents } from '../../src/server/adapter.js';
import { SessionService } from '../../src/session/store.js';
import { ContextService } from '../../src/context/context.js';
import { SkillService } from '../../src/skills/index.js';
import { ToolExecutorService } from '../../src/tools/executor.js';
import { McpService } from '../../src/mcp/index.js';
import { Result } from '../../src/core/result.js';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';
import { ToolSearchService } from '../../src/tools/tool-search-service.js';

const mockState = {
  sessionId: 'test-session',
  cwd: '/tmp/test',
  projectPath: 'test',
  transcriptPath: '/tmp/test.jsonl',
  indexPath: '/tmp/test.index.json',
  messageCount: 0,
  currentTurnId: 0,
  sessionMeta: null,
  title: 'test-sess',
  usage: undefined,
  promptEstimate: 0,
};

function createMockLlm(chunks?: string[], responseContent?: string) {
  return {
    modelInfo: {
      provider: 'mock',
      model: 'mock',
      maxTokens: 1000,
      supportsToolCalling: true,
      supportsStreaming: true,
    },
    complete: () =>
      Promise.resolve(
        Result.ok({
          content: responseContent ?? chunks?.join('') ?? '',
          finishReason: 'stop' as const,
        })
      ),
    completeStream: (_params: any) => ({
      stream: (async function* () {
        for (const c of chunks ?? []) yield c;
      })(),
      response: Promise.resolve(
        Result.ok({
          content: responseContent ?? chunks?.join('') ?? '',
          finishReason: 'stop' as const,
        })
      ),
    }),
  };
}

const MockToolExecutorLayer = Layer.succeed(
  ToolExecutorService,
  ToolExecutorService.of({
    _tag: 'ToolExecutor' as const,
    execute: () => Effect.succeed({ output: 'done' }),
    executeBatch: (toolCalls: any[]) =>
      Effect.succeed(
        toolCalls.map((tc: any) => ({ type: 'ok' as const, id: tc.id, name: tc.name, output: '' }))
      ),
  })
);

const MockSessionLayer = Layer.succeed(
  SessionService,
  SessionService.of({
    _tag: 'Session' as const,
    create: () => Effect.succeed(mockState),
    recordUser: () =>
      Effect.succeed({
        type: 'user' as const,
        uuid: 'u1',
        content: '',
        turnId: 0,
        timestamp: new Date().toISOString(),
      }),
    recordAssistant: () =>
      Effect.succeed({
        type: 'assistant' as const,
        uuid: 'a1',
        content: '',
        toolCalls: [],
        model: 'test',
        turnId: 0,
        timestamp: new Date().toISOString(),
      }),
    recordToolResult: () =>
      Effect.succeed({
        type: 'tool_result' as const,
        uuid: 't1',
        parentUuid: 'a1',
        toolName: 'test',
        toolCallId: 'tc1',
        output: '',
        turnId: 0,
        timestamp: new Date().toISOString(),
        tokenCount: 0,
      }),
    appendSummary: () =>
      Effect.succeed({
        type: 'summary' as const,
        uuid: 's1',
        replaces: [],
        summaryText: '',
        method: 'prune' as const,
        timestamp: new Date().toISOString(),
      }),
    hideMessage: () =>
      Effect.succeed({
        type: 'hide' as const,
        uuid: 'h1',
        kind: 'message' as const,
        targetUuid: '',
        reason: '',
        timestamp: new Date().toISOString(),
      }),
    rollbackToTurn: () =>
      Effect.succeed({
        type: 'hide' as const,
        uuid: 'h1',
        kind: 'rollback' as const,
        throughTurnId: 0,
        reason: '',
        timestamp: new Date().toISOString(),
      }),
    undoLastHide: () => Effect.succeed(null),
    forkSession: () => Effect.succeed('fork-id'),
    renameSession: () =>
      Effect.succeed({
        type: 'title' as const,
        uuid: 't1',
        text: 'renamed',
        timestamp: new Date().toISOString(),
      }),
    readHistory: () => Effect.succeed([]),
    readMessages: () => Effect.succeed([]),
    listSessions: () => Effect.succeed([]),
    getSessionId: () => 'test',
    getMessageCount: () => 0,
    setPermissionMode: () => Effect.succeed(undefined),
    getPermissionMode: () => Effect.succeed('default'),
    incrementTurn: () => 0,
    findSessionIndex: () => Effect.succeed(null),
  })
);

const MockContextLayer = Layer.succeed(
  ContextService,
  ContextService.of({
    _tag: 'Context' as any,
    build: () =>
      Effect.sync(() => ({
        messages: [{ role: 'user' as const, content: 'hi' }],
        newBudgets: [],
        promptEstimate: 0,
      })),
    compress: () => Effect.succeed({ didCompress: true, released: 0, promptEstimate: 0 }),
    compactIfNeeded: () => Effect.succeed({ didCompress: false, released: 0, promptEstimate: 0 }),
  })
);

const MockSkillLayer = Layer.succeed(
  SkillService,
  SkillService.of({
    _tag: 'Skill' as const,
    getAll: () => Effect.succeed([]),
    findByName: () => Effect.succeed(undefined),
    select: () => Effect.succeed(undefined),
    selectImplicit: () => Effect.succeed(undefined),
    extractSkill: () => Effect.succeed([undefined, 'hi']),
    disableSkill: () => Effect.succeed(undefined),
    enableSkill: () => Effect.succeed(undefined),
    listWithStatus: () => Effect.succeed([]),
    evictProject: () => Effect.void,
  })
);

const { AgentService } = await import('../../src/agent/agent.js');
const { ToolLayer, HookLayer } = await import('../../src/layer.js');

const MockCheckpointLayer = Layer.succeed(
  CheckpointService,
  CheckpointService.of({
    _tag: 'Checkpoint' as const,
    snapshotBaseline: () => {},
    snapshotFinal: () => {},
    classifyChanges: () => null,
    getCompletedTurns: () => [],
    forward: () => null,
    hasForwardStack: () => false,
    getCheckpoints: () => [],
  } as any)
);

const MockToolSearchLayer = Layer.succeed(
  ToolSearchService,
  ToolSearchService.of({
    _tag: 'ToolSearchService' as const,
    isLoaded: () => false,
    listLoaded: () => [],
    listUnloadedDeferred: () => [],
    search: () => [],
    reset: () => {},
  })
);

const MockMcpLayer = Layer.succeed(McpService, {
  syncConnections: () => Effect.void,
  connectServers: () => Effect.void,
  disconnectServers: () => Effect.void,
  getServerToolNames: () => [],
  disconnectAll: () => Effect.void,
  status: () => Effect.succeed([]),
} as any);

const { ProjectRuntimeService } = await import('../../src/runtime/project-runtime.js');
const MockProjectRuntimeLayer = ProjectRuntimeService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, MockMcpLayer))
);

const { ApprovalWaitService } = await import('../../src/approval/async-confirm.js');
const { ApprovalService } = await import('../../src/approval/index.js');
const MockApprovalWaitLayer = ApprovalWaitService.Default;
const MockApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, MockApprovalWaitLayer))
);

const AllDeps = Layer.mergeAll(
  MockToolExecutorLayer,
  ToolLayer,
  MockContextLayer,
  MockSessionLayer,
  MockCheckpointLayer,
  MockSkillLayer,
  HookLayer,
  MockToolSearchLayer,
  MockMcpLayer,
  MockProjectRuntimeLayer,
  MockApprovalLayer,
  MockApprovalWaitLayer
);

const TestLayer = Layer.mergeAll(AgentService.Default.pipe(Layer.provide(AllDeps)), AllDeps);

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
    const handler = sseHandler(
      async function* () {
        const { stream } = (await Effect.runPromise(
          program.pipe(Effect.provide(TestLayer) as any)
        )) as any;
        yield* toSseEvents(stream);
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    expect(events).toHaveLength(8); // 1 turn_id + 1 step + 3 text + 1 message + 1 done + 1 complete
    expect(events[0]).toEqual({ type: 'turn_id', turnId: 0 });
    expect(events[1]).toEqual({ type: 'step', step: 1 });
    expect(events[2]).toEqual({ type: 'text', text: 'Hello', messageId: 1 });
    expect(events[3]).toEqual({ type: 'text', text: ' ', messageId: 1 });
    expect(events[4]).toEqual({ type: 'text', text: 'world', messageId: 1 });
    expect(events[5]).toEqual({ type: 'message', id: 1, content: 'Hello world', partial: false });
    expect(events[6]).toEqual({ type: 'done' });
    expect(events[7]).toEqual({ type: 'complete' });
  });

  it('should send complete event even when LLM returns no text', async () => {
    const llm = createMockLlm([], '');
    const program = sendMessage('test-session', 'hi', '/tmp/test', llm) as any;
    const handler = sseHandler(
      async function* () {
        const { stream } = (await Effect.runPromise(
          program.pipe(Effect.provide(TestLayer) as any)
        )) as any;
        yield* toSseEvents(stream);
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    expect(events[events.length - 1]).toEqual({ type: 'complete' });
  });

  it('should forward [Using: ...] markers when LLM calls tools', async () => {
    const llm = {
      modelInfo: {
        provider: 'mock',
        model: 'mock',
        maxTokens: 1000,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
      complete: () =>
        Promise.resolve(Result.ok({ content: '', finishReason: 'tool_calls' as const })),
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield '\n[Using: readFile]\n';
        })(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            finishReason: 'tool_calls' as const,
            toolCalls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'test.txt' } }],
          })
        ),
      }),
    };

    const program = sendMessage('test-session', 'read file', '/tmp/test', llm) as any;
    const handler = sseHandler(
      async function* () {
        const { stream } = (await Effect.runPromise(
          program.pipe(Effect.provide(TestLayer) as any)
        )) as any;
        yield* toSseEvents(stream);
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    const textEvent = events.find((e: any) => e.type === 'text');
    expect(textEvent).toBeDefined();
    expect(textEvent!.text).toContain('[Using:');
  });

  it('should send error event when factory throws', async () => {
    const handler = sseHandler(
      async function* () {
        throw new Error('boom');
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    expect(events.some((e: any) => e.type === 'error')).toBe(true);
  });
});
