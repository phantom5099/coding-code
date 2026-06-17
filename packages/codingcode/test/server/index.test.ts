import { describe, it, expect, vi } from 'vitest';
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

const MockWorkspaceLayer = Layer.succeed(WorkspaceService, {
  getWorkspaceCwd: () => '/tmp/test',
  resolveWorkspaceCwd: (override?: string) => override ?? '/tmp/test',
} as any);

const MockSessionLayer = Layer.succeed(SessionService, {
  create: () => Effect.succeed({ sessionId: 'test', cwd: '/tmp/test' }),
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
  incrementTurn: () => 0,
} as any);

const MockLLMFactoryLayer = Layer.succeed(LLMFactoryService, {
  getLLMClient: () => Effect.succeed(null),
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

const MockContextLayer = Layer.succeed(ContextService, {} as any);

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

describe('createServer', () => {
  it('creates server without LLM client initialization', async () => {
    const app = await createServer(rt);
    expect(app).toBeDefined();
    expect(app).toBeInstanceOf(Object);
  });

  it('health endpoint returns ok without API key', async () => {
    const app = await createServer(rt);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });
});
