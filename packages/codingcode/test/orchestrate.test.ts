import { describe, it, expect, vi } from 'vitest';
import { Context, Effect, Layer } from 'effect';
import { HookService } from '../src/hooks/registry.js';
import { SessionService } from '../src/session/store.js';
import { SkillService } from '../src/skills/service.js';
import { CheckpointService } from '../src/checkpoint/checkpoint-service.js';
import { ProjectRuntimeService } from '../src/runtime/project-runtime.js';
import { TodoService } from '../src/agent/todo.js';
import { ContextService } from '../src/context/service.js';
import { MemoryService } from '../src/memory/index.js';
import { RulesService } from '../src/rules/index.js';
import { LLMFactoryService } from '../src/llm/factory.js';
import { SubagentRunnerService } from '../src/subagent/runner-service.js';

vi.mock('../src/checkpoint/checkpoint-service.js', () => {
  const tag = Context.GenericTag<any>('Checkpoint');
  return {
    CheckpointService: tag,
    snapshotBaseline: vi.fn(),
    snapshotFinal: vi.fn(),
    getCompletedTurns: vi.fn(() => []),
    getCheckpoints: vi.fn(() => []),
    getCheckpointDiff: vi.fn(() => ({ turnId: 0, files: [] })),
    revertCheckpointFiles: vi.fn(() => ({
      reverted: false,
      throughTurnId: 0,
      affectedTurns: [],
      selectedFiles: [],
      restoreEntry: null,
    })),
    previewRollbackDiff: vi.fn(() => ({ throughTurnId: 0, affectedTurns: [], diff: '' })),
    rollbackCodeToTurn: vi.fn(() => ({
      reverted: false,
      throughTurnId: 0,
      affectedTurns: [],
      selectedFiles: [],
      restoreEntry: null,
    })),
    undoLastCodeRollback: vi.fn(() => ({
      restored: false,
      conflict: false,
      conflictFiles: [],
      restoredFiles: [],
      remainingRolledBack: [],
    })),
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
  model: 'test',
  title: 'test-sess',
  usage: undefined,
  memorySnapshot: '',
};

const MockCheckpointLayer = Layer.succeed(CheckpointService, {
  _tag: 'Checkpoint' as const,
  snapshotBaseline: vi.fn(() => Effect.void),
  snapshotFinal: vi.fn(() => Effect.void),
  getCompletedTurns: vi.fn(() => Effect.succeed([])),
  getCheckpoints: vi.fn(() => Effect.succeed([])),
  getCheckpointDiff: vi.fn(() => Effect.succeed({ turnId: 0, files: [] })),
  revertCheckpointFiles: vi.fn(() =>
    Effect.succeed({
      reverted: false,
      throughTurnId: 0,
      affectedTurns: [],
      selectedFiles: [],
      restoreEntry: null,
    })
  ),
  previewRollbackDiff: vi.fn(() =>
    Effect.succeed({ throughTurnId: 0, affectedTurns: [], diff: '' })
  ),
  rollbackCodeToTurn: vi.fn(() =>
    Effect.succeed({
      reverted: false,
      throughTurnId: 0,
      affectedTurns: [],
      selectedFiles: [],
      restoreEntry: null,
    })
  ),
  undoLastCodeRollback: vi.fn(() =>
    Effect.succeed({
      restored: false,
      conflict: false,
      conflictFiles: [],
      restoredFiles: [],
      remainingRolledBack: [],
    })
  ),
  getLatestRestoreEntry: vi.fn(() => Effect.succeed(null)),
} as any);

const MockSkillLayer = Layer.succeed(SkillService, {
  _tag: 'Skill' as const,
  getAll: vi.fn(() => Effect.succeed([])),
  findByName: vi.fn(() => Effect.succeed(undefined)),
  select: vi.fn(() => Effect.succeed(undefined)),
  selectImplicit: vi.fn(() => Effect.succeed(undefined)),
  extractSkill: vi.fn((_p: string, q: string) =>
    Effect.sync(() => [undefined, q] as [undefined, string])
  ),
  disableSkill: vi.fn(() => Effect.void),
  enableSkill: vi.fn(() => Effect.void),
  listWithStatus: vi.fn(() => Effect.succeed([])),
  evictProject: vi.fn(() => Effect.void),
} as any);

import { sendMessage } from '../src/agent/agent.js';
import { ToolExecutorService } from '../src/tools/executor.js';
import { Result } from '../src/core/result.js';
import { McpService } from '../src/mcp/index.js';

const mockLlm = {
  modelInfo: {
    provider: 'mock',
    model: 'mock-model',
    maxTokens: 1000,
    supportsToolCalling: true,
    supportsStreaming: true,
  },
  complete: () => Effect.succeed({ content: 'Hello world', finishReason: 'stop' as const }),
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

const AgentService = Context.GenericTag<any>('Agent');
const AgentLayer = Layer.succeed(AgentService, {
  runStream: async function* (opts: any) {
    const messages = [{ role: 'user' as const, content: 'hi' }];
    yield { _tag: 'TurnId', turnId: 0 };
    yield { _tag: 'Step', step: 1, max: opts.maxStepsOverride ?? 10 };
    const { stream: rawStream, response } = opts.llm.completeStream({
      messages,
      system: '',
      tools: [],
    });
    for await (const chunk of rawStream) {
      yield { _tag: 'LlmChunk', text: chunk };
    }
    const resp = await response;
    const content = (resp as any).ok ? ((resp as any).value?.content ?? '') : '';
    const toolCalls = (resp as any).ok ? (resp as any).value?.toolCalls : undefined;
    yield { _tag: 'Assistant', content, toolCalls };
    yield { _tag: 'Done', content };
  },
});

const MockMcpLayer = Layer.succeed(McpService, {
  syncConnections: (_: string) => Effect.void,
  status: (_: string) => Effect.succeed([]),
  listProjectMcpTools: (_: string) => [],
} as any);

vi.mock('../src/runtime/project-runtime.js', () => ({
  ProjectRuntimeService: Context.GenericTag<any>('ProjectRuntime'),
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
  create: (_cwd: string, _model: string) => Effect.succeed({ ...mockState }),
  recordUser: () =>
    Effect.succeed({
      type: 'user' as const,
      content: '',
      turnId: 0,
    }),
  recordAssistant: () =>
    Effect.succeed({
      type: 'assistant' as const,
      content: '',
      toolCalls: [],

      turnId: 0,
    }),
  recordToolResult: () =>
    Effect.succeed({
      type: 'tool_result' as const,
      toolName: 'test',
      toolCallId: 'tc1',
      output: '',
      turnId: 0,
    }),
  incrementTurn: () => 0,
} as any);

const { ApprovalWaitService } = await import('../src/approval/async-confirm.js');
const { ApprovalService } = await import('../src/approval/index.js');
const MockApprovalWaitLayer = ApprovalWaitService.Default;
const HookLayer = HookService.Default;
const MockApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, MockApprovalWaitLayer))
);

const MockProjectRuntimeLayer = Layer.succeed(ProjectRuntimeService, {
  prepareProject: () => Effect.void,
  resolveMainAgentProfile: () => undefined,
  resolveSubagentProfile: () => undefined,
  listAgentProfiles: () => [],
  getToolPolicy: () => ({
    allowedTools: undefined,
    allowedMcpServers: undefined,
    allowToolSearch: true,
    allowDeferredTools: false,
  }),
  setSessionProfile: () => {},
  getSessionProfile: () => undefined,
  disposeSession: () => Effect.void,
  disposeProject: () => Effect.void,
} as any);

const MockTodoLayer = Layer.succeed(TodoService, {
  read: () => [],
  write: () => {},
  reset: () => {},
} as any);

const MockContextLayer = Layer.succeed(ContextService, {
  assemblePayload: () => ({
    messages: [{ role: 'user' as const, content: 'hi' }],
    compactedEvents: [],
    promptEstimate: 0,
    currentTurnId: 0,
    compactedTurnIds: new Set<number>(),
  }),
  compactIfNeeded: () => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 0 }),
  compactWithLLM: () => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 0 }),
} as any);

const MockMemoryLayer = Layer.succeed(MemoryService, {
  getMemoryEnabled: () => false,
  setMemoryEnabled: () => {},
  loadMemoryForPrompt: () => '',
  flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
} as any);

const MockRulesLayer = Layer.succeed(RulesService, {
  getAllRules: () => '',
  evictProjectRules: () => {},
} as any);

const MockLLMFactoryLayer = Layer.succeed(LLMFactoryService, {
  listModels: () => Effect.succeed([]),
  findModel: () => Effect.succeed(null),
  getActiveEntry: () => Effect.fail(new Error('no active model')),
  setActiveEntry: () => Effect.void,
  createClient: () => Effect.fail(new Error('no factory')),
} as any);

const MockSubagentRunnerLayer = Layer.succeed(SubagentRunnerService, {
  runStream: async function* () {
    yield { _tag: 'Done' as const, content: '' };
  },
} as any);

const AllDeps = Layer.mergeAll(
  MockToolExecutorLayer,
  HookLayer,
  MockMcpLayer,
  MockSessionLayer,
  MockApprovalLayer,
  MockApprovalWaitLayer,
  MockCheckpointLayer,
  MockSkillLayer,
  MockProjectRuntimeLayer,
  MockTodoLayer,
  MockContextLayer,
  MockMemoryLayer,
  MockRulesLayer,
  MockLLMFactoryLayer,
  MockSubagentRunnerLayer
);

const TestLayer = Layer.mergeAll(AgentLayer, AllDeps);

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
