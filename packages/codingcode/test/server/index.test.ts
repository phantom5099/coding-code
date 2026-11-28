import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createServer } from '@codingcode/http';
import { SessionService } from '@codingcode/session';
import { LLMService } from '@codingcode/model';
import { ApprovalService } from '@codingcode/approval';
import { ApprovalWaitService } from '@codingcode/approval';
import { HookService } from '@codingcode/hook';
import { SkillService } from '@codingcode/skill';
import { McpService } from '@codingcode/mcp';
import { MemoryService } from '@codingcode/memory';
import { SchedulerService } from '@codingcode/scheduler';
import { ContextService } from '@codingcode/context';
import { CheckpointService } from '@codingcode/checkpoint';
import { HookLayer } from '@codingcode/hook';
import { ApprovalWaitLayer } from '@codingcode/approval';
import { ApprovalLayer } from '@codingcode/approval';
import { EventSinkLayer } from '@codingcode/sink';

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

const MockLLMLayer = Layer.succeed(LLMService, {
  complete: () => Effect.fail(new Error('LLM not available in test')),
  completeStream: () => (async function* () {})(),
} as any);

const MockApprovalLayer = ApprovalLayer.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, EventSinkLayer, ApprovalWaitLayer))
);

const MockSkillLayer = Layer.succeed(SkillService, {
  _tag: 'Skill' as const,
  getAll: () => Effect.succeed([]),
  readContent: () => Effect.succeed(''),
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
  compact: () => Effect.succeed({ didCompress: false, released: 0, promptEstimate: 0 }),
  dispose: () => Effect.void,
} as any);

const MockCheckpointLayer = Layer.succeed(CheckpointService, {
  _tag: 'Checkpoint' as const,
  ensureBaseline: () => Effect.void,
  getCheckpointDiff: () => Effect.succeed({ turnId: 0, files: [] }),
  revertCheckpointFiles: () =>
    Effect.succeed({
      reverted: false,
      throughTurnId: 0,
      affectedTurns: [],
      selectedFiles: [],
    }),
  previewRollbackDiff: () => Effect.succeed({ throughTurnId: 0, affectedTurns: [], diff: '' }),
} as any);

const TestLayer = Layer.mergeAll(
  MockSessionLayer,
  MockLLMLayer,
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
