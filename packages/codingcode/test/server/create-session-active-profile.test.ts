import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { SessionService } from '../../src/session/store.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
import { SubagentService } from '../../src/subagent/registry.js';
import { RulesService } from '../../src/rules/index.js';
import { WorkspaceService } from '../../src/core/workspace.js';
import { createSessionsRouter } from '../../src/server/routes/sessions.js';

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

function makeLayer() {
  const HookTestLayer = Layer.succeed(HookService, mockHookService as any);
  const McpTestLayer = Layer.succeed(McpService, mockMcpService);
  const SubagentTestLayer = SubagentService.Default;
  const RulesTestLayer = Layer.succeed(RulesService, mockRulesService);
  const SessionTestLayer = SessionService.Default;
  const WorkspaceTestLayer = WorkspaceService.Default;
  const ProjectRuntimeTestLayer = ProjectRuntimeService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        HookTestLayer,
        McpTestLayer,
        SubagentTestLayer,
        RulesTestLayer,
        SessionTestLayer,
        WorkspaceTestLayer
      )
    )
  );
  return Layer.mergeAll(ProjectRuntimeTestLayer, SessionTestLayer, WorkspaceTestLayer);
}

describe('POST /api/sessions — activeProfile persistence (v13 改 1)', () => {
  let cwd: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;
  let app: Hono;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-create-session-test-'));
    rt = ManagedRuntime.make(makeLayer() as any);
    app = new Hono();
    app.route('/api/sessions', createSessionsRouter(rt));
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
      })
    );
  });

  afterEach(async () => {
    await rt.dispose();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('writes idx.permissionMode AND idx.activeProfile when initialPermissionMode=plan', async () => {
    // After the plan refactor, `permissionMode` is no longer a plan-specific
    // value. The plan-mode signal lives in `activeProfile`; the approval
    // pipeline itself only sees a generic permission mode.
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, initialPermissionMode: 'plan' }),
    });
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();

    // Load state to get indexPath
    const indexPath = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        return state.indexPath;
      })
    );

    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.permissionMode).toBe('default');
    expect(idx.activeProfile).toBe('plan');
  });

  it('writes idx.activeProfile=build when initialPermissionMode=default (build)', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, initialPermissionMode: 'default' }),
    });
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();

    const indexPath = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        return state.indexPath;
      })
    );

    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.permissionMode).toBe('default');
    expect(idx.activeProfile).toBe('build');
  });

  it('does not write activeProfile when no initialPermissionMode is provided', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd }),
    });
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();

    const indexPath = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        return state.indexPath;
      })
    );

    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.activeProfile).toBeUndefined();
  });

  it('new session with plan: state.activeProfile is set, restoreSessionProfile succeeds', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, initialPermissionMode: 'plan' }),
    });
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();

    // Simulate the agent.sendMessage flow: load + restore
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        expect(state.activeProfile).toBe('plan');
        yield* runtime.restoreSessionProfile(cwd, sessionId, state.activeProfile);
        const profile = runtime.getSessionProfile(sessionId);
        expect(profile?.name).toBe('plan');
        // The approval-side permission mode is 'default' (pipeline is
        // plan-blind); plan-mode is enforced structurally by the
        // `plan/planModeGateHook`.
        expect(runtime.getSessionPermissionMode(sessionId)).toBe('default');
      })
    );
  });
});
