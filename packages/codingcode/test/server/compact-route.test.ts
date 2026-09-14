import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createServer } from '../../src/server/index.js';
import { WorkspaceService } from '../../src/workspace/workspace.js';
import { SessionService } from '../../src/session/port.js';
import { LLMFactoryService } from '../../src/llm/port.js';
import { ApprovalService } from '../../src/approval/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { HookService } from '../../src/hooks/port.js';
import { SkillService } from '../../src/skills/port.js';
import { McpService } from '../../src/mcp/port.js';
import { MemoryService } from '../../src/memory/port.js';
import { SchedulerService } from '../../src/scheduler/port.js';
import { ContextService } from '../../src/context/port.js';
import { CheckpointService } from '../../src/checkpoint/port.js';
import { HookLayer } from '../../src/hooks/hooks.js';
import { ApprovalWaitLayer } from '../../src/approval/wait.js';
import { ApprovalLayer } from '../../src/approval/approval.js';

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
      model: 'deepseek-chat',
      activeProfile: 'build',
      permissionMode: 'default',
    }),
  load: () =>
    Effect.succeed({
      sessionId: 'test-sid',
      cwd: '/tmp/test',
      model: 'deepseek-chat',
      activeProfile: 'build',
      permissionMode: 'default',
    }),
  recordUser: () => Effect.succeed({ type: 'user', content: '', turnId: 0 }),
  recordAssistant: () =>
    Effect.succeed({
      type: 'assistant',
      content: '',
      toolCalls: [],
      turnId: 0,
    }),
  recordToolResult: () =>
    Effect.succeed({
      type: 'tool_result',
      toolName: 'test',
      toolCallId: 'tc1',
      output: '',
      turnId: 0,
    }),
} as any);

const MockLLMFactoryLayer = Layer.succeed(LLMFactoryService, {
  findModel: () =>
    Effect.succeed({
      id: 'deepseek-chat',
      model: 'deepseek-chat',
      activeProfile: 'build',
      permissionMode: 'default',
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
        activeProfile: 'build',
        permissionMode: 'default',
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
      activeProfile: 'build',
      permissionMode: 'default',
      provider: 'deepseek',
      driver: 'openai',
      api_key_env: 'DEEPSEEK_API_KEY',
      base_url: 'https://api.deepseek.com',
    }),
  switchModel: () => Effect.fail(new Error('no models')),
} as any);

const MockApprovalLayer = ApprovalLayer.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, ApprovalWaitLayer))
);

const MockSkillLayer = Layer.succeed(SkillService, {
  _tag: 'Skill' as const,
  getAll: () => Effect.succeed([]),
  extractSkill: (_p: string, q: string) => Effect.sync(() => [undefined, q] as [undefined, string]),
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
  assemblePayload: async () => [],
  compactWithLLM: mockCompactWithLLM,
} as any);

const MockCheckpointLayer = Layer.succeed(CheckpointService, {
  _tag: 'Checkpoint' as const,
  snapshotBaseline: () => Effect.void,
  snapshotFinal: () => Effect.void,
  getCheckpointDiff: () => Effect.succeed({ turnId: 0, files: [] }),
  revertCheckpointFiles: () =>
    Effect.succeed({
      reverted: false,
      throughTurnId: 0,
      affectedTurns: [],
      selectedFiles: [],
    }),
  previewRollbackDiff: () => Effect.succeed({ throughTurnId: 0, affectedTurns: [], diff: '' }),
  rollbackCodeToTurn: () =>
    Effect.succeed({
      reverted: false,
      throughTurnId: 0,
      affectedTurns: [],
      selectedFiles: [],
    }),
} as any);

const TestLayer = Layer.mergeAll(
  MockWorkspaceLayer,
  MockSessionLayer,
  MockLLMFactoryLayer,
  MockApprovalLayer,
  HookLayer,
  ApprovalWaitLayer,
  MockSkillLayer,
  MockMcpLayer,
  MockMemoryLayer,
  MockSchedulerLayer,
  MockContextLayer,
  MockCheckpointLayer
);

const rt = ManagedRuntime.make(TestLayer as any);

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
    // args[2] is the llm parameter — should not be null
    expect(args?.[2]).not.toBeNull();
    expect(args?.[2].modelInfo.model).toBe('deepseek-chat');
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
            activeProfile: 'build',
            permissionMode: 'default',
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
      HookLayer,
      ApprovalWaitLayer,
      MockSkillLayer,
      MockMcpLayer,
      MockMemoryLayer,
      MockSchedulerLayer,
      MockContextLayer,
      MockCheckpointLayer
    );
    const failRt = ManagedRuntime.make(FailLayer as any);
    const app = await createServer(failRt);
    const res = await app.request('/api/sessions/test-sid/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '' }),
    });

    expect(res.status).toBe(200);
    expect(mockCompactWithLLM).toHaveBeenCalledTimes(1);

    const args = mockCompactWithLLM.mock.calls[0];
    expect(args?.[2]).toBeNull();
  });
});
