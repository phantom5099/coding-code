import { describe, it, expect, vi } from 'vitest';
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
} as any);

const MockLLMFactoryLayer = Layer.succeed(LLMFactoryService, {
  getLLMClient: () => Effect.succeed(null),
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

const MockContextLayer = Layer.succeed(ContextService, {} as any);

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
