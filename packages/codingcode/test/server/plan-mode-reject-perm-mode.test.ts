import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { SessionService } from '../../src/session/store.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
import { SubagentService } from '../../src/subagent/registry.js';
import { RulesService } from '../../src/rules/index.js';
import { ApprovalService } from '../../src/approval/index.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { createAgentRouter } from '../../src/server/routes/agent.js';
import { PLAN_PROFILE, BUILD_PROFILE } from '../../src/subagent/registry.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

const mockHookService = {
  register: () => Effect.succeed(() => {}),
  registerDecision: () => Effect.succeed(() => {}),
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
  attachSessionHooks: () => Effect.succeed(undefined),
  disableHook: () => Effect.succeed(undefined),
  enableHook: () => Effect.succeed(undefined),
  disposeSession: () => Effect.succeed(undefined),
  disposeProject: () => Effect.succeed(undefined),
};

const mockMcpService = {
  syncConnections: () => Effect.succeed(undefined),
  connectServers: () => Effect.succeed(undefined),
  listProjectMcpTools: () => [],
  disposeSession: () => Effect.succeed(undefined),
} as any;

const mockRulesService = {
  getAllRules: () => '',
  evictProjectRules: () => undefined,
} as any;

const mockApprovalWaitService = {
  waitForConfirm: () => Effect.dieMessage('not implemented'),
  resolveConfirm: () => Effect.succeed(false),
  getPending: () => Effect.succeed([]),
  emitApprovalRequest: () => Effect.succeed(undefined),
  registerEmitter: () => Effect.succeed(undefined),
  delegateEmitter: () => Effect.succeed(undefined),
  unregisterEmitter: () => Effect.succeed(undefined),
  hasEmitter: () => Effect.succeed(false),
};

describe('POST /api/agent/permission-mode rejects when session is in plan mode', () => {
  let cwd: string;
  let sessionId: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;
  let app: Hono;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-server-test-'));
    const HookTestLayer = Layer.succeed(HookService, mockHookService as any);
    const McpTestLayer = Layer.succeed(McpService, mockMcpService);
    const SubagentTestLayer = SubagentService.Default;
    const RulesTestLayer = Layer.succeed(RulesService, mockRulesService);
    const SessionTestLayer = SessionService.Default;
    const ProjectRuntimeTestLayer = ProjectRuntimeService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          HookTestLayer,
          McpTestLayer,
          SubagentTestLayer,
          RulesTestLayer,
          SessionTestLayer
        )
      )
    );
    const ApprovalTestLayer = ApprovalService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          HookTestLayer,
          Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any)
        )
      )
    );
    const TestLayer = Layer.mergeAll(
      ProjectRuntimeTestLayer,
      SessionTestLayer,
      HookTestLayer,
      ApprovalTestLayer,
      Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any)
    );
    rt = ManagedRuntime.make(TestLayer as any);
    app = new Hono();
    app.route('/api/agent', createAgentRouter(rt));

    sessionId = await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        const session = yield* SessionService;
        yield* runtime.prepareProject(cwd);
        const state = yield* session.create(cwd, {
          model: 'test-model',
          mode: 'build',
          permissionMode: 'default',
        });
        return state.sessionId;
      })
    );
  });

  afterEach(async () => {
    await rt.dispose();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns 409 when session is in plan profile', async () => {
    // Switch session to plan
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        yield* runtime.setSessionProfile(cwd, sessionId, PLAN_PROFILE);
      })
    );

    const res = await app.request('/api/agent/permission-mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'bypass', cwd, sessionId }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/plan mode/i);
  });

  it('allows the change when session is in build profile', async () => {
    // Switch to build (default)
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        yield* runtime.setSessionProfile(cwd, sessionId, BUILD_PROFILE);
      })
    );

    const res = await app.request('/api/agent/permission-mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'bypass', cwd, sessionId }),
    });
    expect(res.status).toBe(200);
  });

  it('falls back to global when cwd+sessionId not provided (legacy clients)', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        yield* runtime.setSessionProfile(cwd, sessionId, PLAN_PROFILE);
      })
    );

    // No cwd/sessionId — bypass check, change applies to global ApprovalService
    const res = await app.request('/api/agent/permission-mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'bypass' }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects invalid mode value with 400', async () => {
    const res = await app.request('/api/agent/permission-mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'invalid', cwd, sessionId }),
    });
    expect(res.status).toBe(400);
  });
});
