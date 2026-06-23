/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { mkdirSync, writeFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { Hono } from 'hono';
import { createSessionsRouter } from '../../src/server/routes/sessions.js';
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
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { setProjectBaseDir } from '../../src/core/path.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

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
  load: () =>
    Effect.succeed({
      sessionId: 'test-sid',
      cwd: '/tmp/test',
      projectPath: 'test-path',
      transcriptPath: '/tmp/test.jsonl',
      model: 'deepseek-chat',
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
  compactWithLLM: () => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 0 }),
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

const MockProjectRuntimeLayer = Layer.succeed(ProjectRuntimeService, {
  getSessionProfile: () => 'plan',
  setSessionProfile: () => Effect.void,
  resolveSubagentProfile: () => undefined,
  registerActiveSession: () => Effect.void,
  unregisterActiveSession: () => Effect.void,
  getActiveSessions: () => [],
  clearActiveSessions: () => Effect.void,
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
  MockCheckpointLayer,
  MockProjectRuntimeLayer
);

let tempBase = '';
let plansDir = '';

beforeEach(() => {
  tempBase = mkdtempSync(join(tmpdir(), 'codingcode-plan-route-'));
  // The route reads getProjectBaseDir() + encodeProjectPath(cwd).
  // encodeProjectPath('/tmp/test') -> 'tmp-test'.
  plansDir = join(tempBase, 'tmp-test');
  mkdirSync(plansDir, { recursive: true });
  setProjectBaseDir(tempBase);
});

afterEach(() => {
  setProjectBaseDir(undefined);
  rmSync(tempBase, { recursive: true, force: true });
});

describe('GET /api/sessions/:id/plan', () => {
  it('returns exists:false with empty content when no .md file is present', async () => {
    const rt = ManagedRuntime.make(TestLayer);
    const router = createSessionsRouter(rt);
    const app = new Hono();
    app.route('/api/sessions', router);
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

    const rt = ManagedRuntime.make(TestLayer);
    const router = createSessionsRouter(rt);
    const app = new Hono();
    app.route('/api/sessions', router);
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

    const rt = ManagedRuntime.make(TestLayer);
    const router = createSessionsRouter(rt);
    const app = new Hono();
    app.route('/api/sessions', router);
    const res = await app.request('/api/sessions/s-1/plan?cwd=/tmp/test');
    const body = (await res.json()) as { content: string; exists: boolean };
    expect(body.exists).toBe(true);
    expect(body.content).toBe('# ONLY-MD');
  });
});
