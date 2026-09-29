/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { mkdirSync, writeFileSync, utimesSync } from 'fs';
import { join, resolve } from 'path';
import { Hono } from 'hono';
import { registerSessionsRoutes } from '../../src/server/routes/sessions.js';
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
import { encodeProjectPath, getProjectBaseDir } from '../../src/core/path.js';
import { useTempHome } from '../helpers/temp-home.js';
import { HookLayer } from '../../src/hooks/hooks.js';
import { ApprovalWaitLayer } from '../../src/approval/wait.js';
import { ApprovalLayer } from '../../src/approval/approval.js';

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
    Effect.succeed({ type: 'assistant', content: '', toolCalls: [], turnId: 0 }),
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
  listProjectMcpTools: () => [],
  status: () => Effect.succeed([]),
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
  compactWithLLM: () => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 0 }),
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

// home 指向临时目录 ⇒ getProjectBaseDir() = <temp>/.codingcode/project
useTempHome('codingcode-plan-route-');

let plansDir = '';

beforeEach(() => {
  // The route resolves the query cwd to an absolute path first
  // (core/path.resolveCwd -> path.resolve), then encodes it.
  plansDir = join(getProjectBaseDir(), encodeProjectPath(resolve('/tmp/test')));
  mkdirSync(plansDir, { recursive: true });
});

describe('GET /api/sessions/:id/plan', () => {
  it('returns exists:false with empty content when no .md file is present', async () => {
    const rt = ManagedRuntime.make(TestLayer as any);
    const app = new Hono();
    registerSessionsRoutes(app, rt);
    const res = await app.request('/api/sessions/s-1/plan?cwd=/tmp/test');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      content: string;
      path: string;
      directory: string;
      exists: boolean;
    };
    expect(body.exists).toBe(false);
    expect(body.content).toBe('');
    expect(body.path).toBe('');
  });

  it('returns the most-recently-modified .md file in the plan directory', async () => {
    const oldPath = join(plansDir, 'old-plan.md');
    const newPath = join(plansDir, 'new-plan.md');
    writeFileSync(oldPath, '# OLD', 'utf8');
    writeFileSync(newPath, '# NEW', 'utf8');
    // Make `oldPlan` newer so that we can verify the route picks by mtime, not by name
    const newerDate = new Date();
    const olderDate = new Date(newerDate.getTime() - 60_000);
    utimesSync(oldPath, olderDate, olderDate);
    utimesSync(newPath, newerDate, newerDate);

    const rt = ManagedRuntime.make(TestLayer as any);
    const app = new Hono();
    registerSessionsRoutes(app, rt);
    const res = await app.request('/api/sessions/s-1/plan?cwd=/tmp/test');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      content: string;
      path: string;
      exists: boolean;
    };
    expect(body.exists).toBe(true);
    expect(body.path).toBe(newPath);
    expect(body.content).toBe('# NEW');
  });

  it('ignores non-md files in the plan directory', async () => {
    const mdPath = join(plansDir, 'plan.md');
    writeFileSync(mdPath, '# ONLY-MD', 'utf8');
    writeFileSync(join(plansDir, 'notes.txt'), 'should be ignored', 'utf8');

    const rt = ManagedRuntime.make(TestLayer as any);
    const app = new Hono();
    registerSessionsRoutes(app, rt);
    const res = await app.request('/api/sessions/s-1/plan?cwd=/tmp/test');
    const body = (await res.json()) as { content: string; exists: boolean };
    expect(body.exists).toBe(true);
    expect(body.content).toBe('# ONLY-MD');
  });
});
