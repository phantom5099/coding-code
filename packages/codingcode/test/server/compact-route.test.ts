import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createServer } from '../../src/server/index.js';
import { WorkspaceService } from '../../src/core/workspace.js';
import { SessionService } from '../../src/session/store.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
import { ApprovalService } from '../../src/approval/index.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { HookService } from '../../src/hooks/registry.js';
import { SkillService } from '../../src/skills/service.js';
import { McpService } from '../../src/mcp/index.js';
import { MemoryService } from '../../src/memory/index.js';
import { SchedulerService } from '../../src/scheduler/service.js';
import { ContextService } from '../../src/context/service.js';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';

const mockCompactWithLLM = vi.fn();

const MockWorkspaceLayer = Layer.succeed(WorkspaceService, {
  getWorkspaceCwd: () => '/tmp/test',
  resolveWorkspaceCwd: (override?: string) => override ?? '/tmp/test',
} as any);

const MockSessionLayer = Layer.succeed(SessionService, {
  create: () =>
    Effect.succeed({
      sessionId: 'test-sid',
      cwd: '/tmp/test',
      projectPath: 'test-path',
      model: 'deepseek-chat',
    }),
  recordUser: () =>
    Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 0, timestamp: '' }),
  recordAssistant: () =>
    Effect.succeed({
      type: 'assistant',
      uuid: 'a1',
      content: '',
      toolCalls: [],
      model: 'test',
      turnId: 0,
      timestamp: '',
    }),
  recordToolResult: () =>
    Effect.succeed({
      type: 'tool_result',
      uuid: 't1',
      parentUuid: 'a1',
      toolName: 'test',
      toolCallId: 'tc1',
      output: '',
      turnId: 0,
      timestamp: '',
      tokenCount: 0,
    }),
  incrementTurn: () => 0,
} as any);

const MockLLMFactoryLayer = Layer.succeed(LLMFactoryService, {
  findModel: () =>
    Effect.succeed({
      id: 'deepseek-chat',
      model: 'deepseek-chat',
      provider: 'deepseek',
      driver: 'openai',
      api_key_env: 'DEEPSEEK_API_KEY',
      base_url: 'https://api.deepseek.com',
    }),
  createClient: () =>
    Effect.succeed({
      modelInfo: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        maxTokens: 64000,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
    }),
  getLLMClient: () => Effect.succeed(null),
  listModels: () => Effect.succeed([]),
  getActiveEntry: () =>
    Effect.succeed({
      id: 'deepseek-chat',
      model: 'deepseek-chat',
      provider: 'deepseek',
      driver: 'openai',
      api_key_env: 'DEEPSEEK_API_KEY',
      base_url: 'https://api.deepseek.com',
    }),
  switchModel: () => Effect.fail(new Error('no models')),
} as any);

const MockApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookService.Default, ApprovalWaitService.Default))
);

const MockSkillLayer = Layer.succeed(SkillService, {
  _tag: 'Skill' as const,
  getAll: () => Effect.succeed([]),
  findByName: () => Effect.succeed(undefined),
  select: () => Effect.succeed(undefined),
  selectImplicit: () => Effect.succeed(undefined),
  extractSkill: (_p: string, q: string) => Effect.sync(() => [undefined, q] as [undefined, string]),
  enableSkill: () => Effect.void,
  disableSkill: () => Effect.void,
  listWithStatus: () => Effect.succeed([]),
  evictProject: () => Effect.void,
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

const MockMemoryLayer = Layer.succeed(MemoryService, {
  getMemoryEnabled: () => true,
  setMemoryEnabled: () => {},
  loadMemoryForPrompt: () => '',
  flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
} as any);

const MockSchedulerLayer = Layer.succeed(SchedulerService, {
  list: () => [],
  add: () => ({}),
  update: () => null,
  remove: () => false,
  runOnce: () => Promise.resolve('session-id'),
} as any);

const MockContextLayer = Layer.succeed(ContextService, {
  assemblePayload: () => ({
    messages: [],
    compactedEvents: [],
    promptEstimate: 0,
    currentTurnId: 0,
    compactedTurnIds: new Set(),
  }),
  compactWithLLM: mockCompactWithLLM,
} as any);

const MockCheckpointLayer = Layer.succeed(CheckpointService, {
  _tag: 'Checkpoint' as const,
  snapshotBaseline: () => Effect.void,
  snapshotFinal: () => Effect.void,
  getCompletedTurns: () => Effect.succeed([]),
  getCheckpoints: () => Effect.succeed([]),
  getCheckpointDiff: () => Effect.succeed({ turnId: 0, files: [] }),
  revertCheckpointFiles: () =>
    Effect.succeed({
      reverted: false,
      throughTurnId: 0,
      affectedTurns: [],
      selectedFiles: [],
      restoreEntry: null,
    }),
  previewRollbackDiff: () => Effect.succeed({ throughTurnId: 0, affectedTurns: [], diff: '' }),
  rollbackCodeToTurn: () =>
    Effect.succeed({
      reverted: false,
      throughTurnId: 0,
      affectedTurns: [],
      selectedFiles: [],
      restoreEntry: null,
    }),
  undoLastCodeRollback: () =>
    Effect.succeed({
      restored: false,
      conflict: false,
      conflictFiles: [],
      restoredFiles: [],
      remainingRolledBack: [],
    }),
  getLatestRestoreEntry: () => Effect.succeed(null),
} as any);

const TestLayer = Layer.mergeAll(
  MockWorkspaceLayer,
  MockSessionLayer,
  MockLLMFactoryLayer,
  MockApprovalLayer,
  HookService.Default,
  ApprovalWaitService.Default,
  MockSkillLayer,
  MockMcpLayer,
  MockMemoryLayer,
  MockSchedulerLayer,
  MockContextLayer,
  MockCheckpointLayer
);

const rt = ManagedRuntime.make(TestLayer);

describe('POST /api/sessions/:id/compact (manual compact)', () => {
  beforeEach(() => {
    mockCompactWithLLM.mockReset();
    mockCompactWithLLM.mockResolvedValue({
      didCompress: true,
      released: 5000,
      promptEstimate: 3000,
    });
  });

  it('should call compactWithLLM with a non-null llm when session has a valid model', async () => {
    const app = await createServer(rt);
    const res = await app.request('/api/sessions/test-sid/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '' }),
    });

    expect(res.status).toBe(200);
    expect(mockCompactWithLLM).toHaveBeenCalledTimes(1);

    const args = mockCompactWithLLM.mock.calls[0];
    // args[4] is the llm parameter — should not be null
    expect(args?.[4]).not.toBeNull();
    expect(args?.[4].modelInfo.model).toBe('deepseek-chat');
  });

  it('should return CompressResult from the API', async () => {
    const app = await createServer(rt);
    const res = await app.request('/api/sessions/test-sid/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '' }),
    });

    const body = await res.json();
    expect(body).toEqual({ didCompress: true, released: 5000, promptEstimate: 3000 });
  });

  it('should call compactWithLLM with null llm when getActiveEntry fails', async () => {
    const FailingFactoryLayer = Layer.succeed(LLMFactoryService, {
      findModel: () => Effect.succeed(null),
      createClient: () =>
        Effect.succeed({
          modelInfo: {
            provider: 'deepseek',
            model: 'deepseek-chat',
            maxTokens: 64000,
            supportsToolCalling: true,
            supportsStreaming: true,
          },
        }),
      getLLMClient: () => Effect.succeed(null),
      listModels: () => Effect.succeed([]),
      getActiveEntry: () => Effect.fail(new Error('no active model')),
      switchModel: () => Effect.fail(new Error('no models')),
    } as any);

    const FailLayer = Layer.mergeAll(
      MockWorkspaceLayer,
      MockSessionLayer,
      FailingFactoryLayer,
      MockApprovalLayer,
      HookService.Default,
      ApprovalWaitService.Default,
      MockSkillLayer,
      MockMcpLayer,
      MockMemoryLayer,
      MockSchedulerLayer,
      MockContextLayer,
      MockCheckpointLayer
    );
    const failRt = ManagedRuntime.make(FailLayer);
    const app = await createServer(failRt);
    const res = await app.request('/api/sessions/test-sid/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '' }),
    });

    expect(res.status).toBe(200);
    expect(mockCompactWithLLM).toHaveBeenCalledTimes(1);

    const args = mockCompactWithLLM.mock.calls[0];
    expect(args?.[4]).toBeNull();
  });
});
