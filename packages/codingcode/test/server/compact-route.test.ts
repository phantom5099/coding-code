import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createServer } from '../../src/server/index.js';
import { SessionService } from '../../src/session/port.js';
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
import { EventSinkLayer } from '../../src/sink/sink.js';

const mockCompactWithLLM = vi.fn();

const MockSessionLayer = Layer.succeed(SessionService, {
  create: () =>
    Effect.succeed({
      sessionId: 'test-sid',
      cwd: '/tmp/test',
      activeProfile: 'build',
      permissionMode: 'askBeforeExec',
    }),
  load: () =>
    Effect.succeed({
      sessionId: 'test-sid',
      cwd: '/tmp/test',
      activeProfile: 'build',
      permissionMode: 'askBeforeExec',
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

const MockApprovalLayer = ApprovalLayer.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, EventSinkLayer, ApprovalWaitLayer))
);

const MockSkillLayer = Layer.succeed(SkillService, {
  _tag: 'Skill' as const,
  getAll: () => Effect.succeed([]),
  extractSkill: (_p: string, q: string) => Effect.sync(() => [undefined, q] as [undefined, string]),
} as any);

const MockMcpLayer = Layer.succeed(McpService, {
  syncConnections: () => Effect.void,
  listProjectMcpTools: () => [],
  status: () => Effect.succeed([]),
} as any);

const MockMemoryLayer = Layer.succeed(MemoryService, {
  getMemoryEnabled: () => Effect.succeed(true),
  setMemoryEnabled: () => Effect.void,
  loadMemoryForPrompt: () => Effect.succeed(''),
  flushSessionToMemory: () => Effect.succeed({ written: false, bytes: 0 }),
} as any);

const MockSchedulerLayer = Layer.succeed(SchedulerService, {
  list: () => [],
  add: () => ({}),
  update: () => null,
  remove: () => false,
  runOnce: () => Promise.resolve('session-id'),
} as any);

const MockContextLayer = Layer.succeed(ContextService, {
  getHistory: () => Effect.succeed([]),
  absorb: () => Effect.void,
  compact: mockCompactWithLLM,
  dispose: () => Effect.void,
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
  MockSessionLayer,
  MockApprovalLayer,
  HookLayer,
  EventSinkLayer,
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
    mockCompactWithLLM.mockReturnValue(
      Effect.succeed({
        didCompress: true,
        released: 5000,
        promptEstimate: 3000,
      })
    );
  });

  it('should pass the requested model through to compact', async () => {
    const app = await createServer(rt);
    const res = await app.request('/api/sessions/test-sid/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '', model: 'deepseek-chat@deepseek' }),
    });

    expect(res.status).toBe(200);
    expect(mockCompactWithLLM).toHaveBeenCalledTimes(1);

    const args = mockCompactWithLLM.mock.calls[0];
    // context 现在收的是会话身份（cwd + sessionId），转录路径由它自己拼
    const ref = args?.[0] as { cwd: string; sessionId: string };
    expect(typeof ref.cwd).toBe('string');
    expect(typeof ref.sessionId).toBe('string');
    expect(args?.[1]).toBe('deepseek-chat@deepseek');
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

  it('should fall back to the global model (empty string) when the request omits a model', async () => {
    const app = await createServer(rt);
    const res = await app.request('/api/sessions/test-sid/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '' }),
    });

    expect(res.status).toBe(200);
    const args = mockCompactWithLLM.mock.calls[0];
    expect(args?.[1]).toBe('');
  });
});
