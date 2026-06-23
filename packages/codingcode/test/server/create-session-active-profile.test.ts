import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'fs';
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
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

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
} as any;

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
  const HookTestLayer = Layer.succeed(HookService, mockHookService);
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

describe('POST /api/sessions — atomic mode + permissionMode + model', () => {
  let cwd: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;
  let app: Hono;

  beforeEach(async () => {
    cwd = join(base.dir, 'create-session-active-profile');
    mkdirSync(cwd, { recursive: true });
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
  });

  it('writes idx.mode=plan and idx.permissionMode=default when mode=plan', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        mode: 'plan',
        permissionMode: 'default',
        model: 'gpt-4',
      }),
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
    expect(idx.mode).toBe('plan');
    expect(idx.permissionMode).toBe('default');
  });

  it('writes idx.mode=build and idx.permissionMode=bypass when build+bypass', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        mode: 'build',
        permissionMode: 'bypass',
        model: 'gpt-4',
      }),
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
    expect(idx.mode).toBe('build');
    expect(idx.permissionMode).toBe('bypass');
  });

  it('rejects plan mode with non-default permissionMode', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        mode: 'plan',
        permissionMode: 'bypass',
        model: 'gpt-4',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing model', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, mode: 'build', permissionMode: 'default' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing mode', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, permissionMode: 'default', model: 'gpt-4' }),
    });
    expect(res.status).toBe(400);
  });

  it('new session with plan: state.mode is set, getSessionPermissionMode returns default', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        mode: 'plan',
        permissionMode: 'default',
        model: 'gpt-4',
      }),
    });
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();

    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        expect(state.mode).toBe('plan');
        const profile = runtime.getSessionProfile(sessionId);
        expect(profile?.name).toBe('plan');
        // plan-mode forces in-memory permissionMode to 'default'
        expect(runtime.getSessionPermissionMode(sessionId)).toBe('default');
      })
    );
  });
});
