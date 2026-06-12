import { describe, it, expect, vi } from 'vitest';
import { Context, Effect, Layer } from 'effect';
import { HookService } from '../../src/hooks/registry.js';
import { SessionService } from '../../src/session/store.js';
import { SkillService } from '../../src/skills/service.js';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';

vi.mock('../../src/context/organizer.js', () => ({
  assemblePayload: vi.fn(() => ({
    messages: [{ role: 'user' as const, content: 'hi' }],
    compactedEvents: [],
    promptEstimate: 0,
    currentTurnId: 0,
    compactedTurnIds: new Set<number>(),
  })),
}));

vi.mock('../../src/context/compressor.js', () => ({
  compactIfNeeded: vi.fn(() => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 0 })),
  compactWithLLM: vi.fn(() => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 0 })),
}));

vi.mock('../../src/checkpoint/checkpoint-service.js', () => {
  const tag = Context.GenericTag<any>('Checkpoint');
  return {
    CheckpointService: tag,
    snapshotBaseline: vi.fn(),
    snapshotFinal: vi.fn(),
    getCompletedTurns: vi.fn(() => []),
    getCheckpoints: vi.fn(() => []),
    getCheckpointDiff: vi.fn(() => ({ turnId: 0, files: [] })),
    revertCheckpointFiles: vi.fn(() => ({ reverted: false, throughTurnId: 0, affectedTurns: [], selectedFiles: [], restoreEntry: null })),
    previewRollbackDiff: vi.fn(() => ({ throughTurnId: 0, affectedTurns: [], diff: '' })),
    rollbackCodeToTurn: vi.fn(() => ({ reverted: false, throughTurnId: 0, affectedTurns: [], selectedFiles: [], restoreEntry: null })),
    undoLastCodeRollback: vi.fn(() => ({ restored: false, conflict: false, conflictFiles: [], restoredFiles: [], remainingRolledBack: [] })),
    getLatestRestoreEntry: vi.fn(() => null),
  };
});

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
  memorySnapshot: '',
};

import { sseHandler } from '../../src/server/handler.js';
import { sendMessage, AgentService } from '../../src/agent/agent.js';
import { toSseEvents } from '../../src/server/adapter.js';

import { ToolExecutorService } from '../../src/tools/executor.js';
import { McpService } from '../../src/mcp/index.js';
import { Result } from '../../src/core/result.js';
import { AgentError } from '../../src/core/error.js';

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
      Effect.succeed({
        content: responseContent ?? chunks?.join('') ?? '',
        finishReason: 'stop' as const,
      }),
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

const MockCheckpointLayer = Layer.succeed(CheckpointService, {
  _tag: 'Checkpoint' as const,
  snapshotBaseline: vi.fn(() => Effect.void),
  snapshotFinal: vi.fn(() => Effect.void),
  getCompletedTurns: vi.fn(() => Effect.succeed([])),
  getCheckpoints: vi.fn(() => Effect.succeed([])),
  getCheckpointDiff: vi.fn(() => Effect.succeed({ turnId: 0, files: [] })),
  revertCheckpointFiles: vi.fn(() => Effect.succeed({ reverted: false, throughTurnId: 0, affectedTurns: [], selectedFiles: [], restoreEntry: null })),
  previewRollbackDiff: vi.fn(() => Effect.succeed({ throughTurnId: 0, affectedTurns: [], diff: '' })),
  rollbackCodeToTurn: vi.fn(() => Effect.succeed({ reverted: false, throughTurnId: 0, affectedTurns: [], selectedFiles: [], restoreEntry: null })),
  undoLastCodeRollback: vi.fn(() => Effect.succeed({ restored: false, conflict: false, conflictFiles: [], restoredFiles: [], remainingRolledBack: [] })),
  getLatestRestoreEntry: vi.fn(() => Effect.succeed(null)),
} as any);

const MockSkillLayer = Layer.succeed(SkillService, {
  _tag: 'Skill' as const,
  getAll: vi.fn(() => Effect.succeed([])),
  findByName: vi.fn(() => Effect.succeed(undefined)),
  select: vi.fn(() => Effect.succeed(undefined)),
  selectImplicit: vi.fn(() => Effect.succeed(undefined)),
  extractSkill: vi.fn((_p: string, q: string) => Effect.sync(() => [undefined, q] as [undefined, string])),
  disableSkill: vi.fn(() => Effect.void),
  enableSkill: vi.fn(() => Effect.void),
  listWithStatus: vi.fn(() => Effect.succeed([])),
  evictProject: vi.fn(() => Effect.void),
} as any);

const MockMcpLayer = Layer.succeed(McpService, {
  syncConnections: () => Effect.void,
  connectServers: () => Effect.void,
  disconnectServers: () => Effect.void,
  getServerToolNames: () => [],
  disconnectAll: () => Effect.void,
  status: () => Effect.succeed([]),
  listProjectMcpTools: () => [],
} as any);

vi.mock('../../src/runtime/project-runtime.js', () => ({
  prepareProject: vi.fn(() => Effect.void),
  resolveMainAgentProfile: vi.fn((_p: string, _s: string) => undefined),
  resolveSubagentProfile: vi.fn((_p: string, _n: string) => undefined),
  listAgentProfiles: vi.fn((_p: string) => []),
  getToolPolicy: vi.fn(() => ({
    allowedTools: undefined,
    allowedMcpServers: undefined,
    allowToolSearch: true,
    allowDeferredTools: false,
  })),
  setSessionProfile: vi.fn(),
  getSessionProfile: vi.fn(() => undefined),
  disposeSession: vi.fn(() => Effect.void),
  disposeProject: vi.fn(() => Effect.void),
}));

const MockSessionLayer = Layer.succeed(SessionService, {
  create: (_cwd: string, _model: string) =>
    Effect.succeed({ ...mockState }),
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
  incrementTurn: () => 0,
} as any);

const { ApprovalWaitService } = await import('../../src/approval/async-confirm.js');
const { ApprovalService } = await import('../../src/approval/index.js');
const MockApprovalWaitLayer = ApprovalWaitService.Default;
const HookLayer = HookService.Default;
const MockApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, MockApprovalWaitLayer))
);

const AllDeps = Layer.mergeAll(
  MockToolExecutorLayer,
  HookLayer,
  MockMcpLayer,
  MockSessionLayer,
  MockApprovalLayer,
  MockApprovalWaitLayer,
  MockCheckpointLayer,
  MockSkillLayer
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

    expect(events).toHaveLength(8);
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
        Effect.succeed({ content: '', finishReason: 'tool_calls' as const }),
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

  it('should preserve AgentError code in catch', async () => {
    const handler = sseHandler(
      async function* () {
        throw AgentError.toolNotFound('myTool');
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    const errorEvent = events.find((e: any) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.code).toBe('TOOL_NOT_FOUND');
    expect(errorEvent.message).toContain('myTool');
  });

  it('should not include code for plain Error in catch', async () => {
    const handler = sseHandler(
      async function* () {
        throw new Error('plain error');
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    const errorEvent = events.find((e: any) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.code).toBeUndefined();
  });
});
