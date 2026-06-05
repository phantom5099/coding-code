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

const mockLlm = {
  modelInfo: {
    provider: 'mock',
    model: 'mock-model',
    maxTokens: 1000,
    supportsToolCalling: true,
    supportsStreaming: true,
  },
  complete: () =>
    Promise.resolve(Result.ok({ content: 'Hello world', finishReason: 'stop' as const })),
  completeStream: (_params: any) => {
    const stream = (async function* () {
      yield 'Hello';
      yield ' ';
      yield 'world';
    })();
    return {
      stream,
      response: Promise.resolve(
        Result.ok({ content: 'Hello world', finishReason: 'stop' as const })
      ),
    };
  },
};

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
        toolCalls: [] as any,
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

const { AgentService } = await import('../src/agent/agent.js');
const { HookLayer } = await import('../src/layer.js');

const MockMcpLayer = Layer.succeed(McpService, {
  syncConnections: (_: string) => Effect.void,
  status: (_: string) => Effect.succeed([]),
} as any);

const { ProjectRuntimeService } = await import('../src/runtime/project-runtime.js');
const MockProjectRuntimeLayer = ProjectRuntimeService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, MockMcpLayer))
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
    disposeSession: () => {},
  })
);

const { ApprovalWaitService } = await import('../src/approval/async-confirm.js');
const { ApprovalService } = await import('../src/approval/index.js');
const MockApprovalWaitLayer = ApprovalWaitService.Default;
const MockApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, MockApprovalWaitLayer))
);

const AllDeps = Layer.mergeAll(
  MockToolExecutorLayer,
  MockContextLayer,
  MockSessionLayer,
  MockCheckpointLayer,
  MockSkillLayer,
  HookLayer,
  MockMcpLayer,
  MockToolSearchLayer,
  MockProjectRuntimeLayer,
  MockApprovalLayer,
  MockApprovalWaitLayer
);

const TestLayer = Layer.mergeAll(AgentService.Default.pipe(Layer.provide(AllDeps)), AllDeps);

describe('sendMessage stream', () => {
  it('should yield AgentEvent chunks from LLM', async () => {
    const program = sendMessage(undefined, 'hi', '/tmp/test', mockLlm);
    const { stream } = (await Effect.runPromise(
      program.pipe(Effect.provide(TestLayer) as any)
    )) as any;

    const events: any[] = [];
    for await (const event of stream) events.push(event);

    const textChunks = events.filter((e: any) => e._tag === 'LlmChunk').map((e: any) => e.text);
    expect(textChunks).toContain('Hello');
    expect(textChunks).toContain(' ');
    expect(textChunks).toContain('world');
  });

  it('should not return empty event stream for normal LLM response', async () => {
    const program = sendMessage(undefined, 'hi', '/tmp/test', mockLlm);
    const { stream } = (await Effect.runPromise(
      program.pipe(Effect.provide(TestLayer) as any)
    )) as any;

    const events: any[] = [];
    for await (const event of stream) events.push(event);

    expect(events.length).toBeGreaterThan(0);
  });
});
