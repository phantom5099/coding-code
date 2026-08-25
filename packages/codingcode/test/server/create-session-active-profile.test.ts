import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { SessionService } from '../../src/session/store.js';
import { computePaths } from '../../src/core/path.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
import { RulesService } from '../../src/rules/index.js';
import { WorkspaceService } from '../../src/core/workspace.js';
import { registerSessionsRoutes } from '../../src/server/routes/sessions.js';
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
  const RulesTestLayer = Layer.succeed(RulesService, mockRulesService);
  const SessionTestLayer = SessionService.Default;
  const WorkspaceTestLayer = WorkspaceService.Default;
  const ProjectRuntimeTestLayer = ProjectRuntimeService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        HookTestLayer,
        McpTestLayer,
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
    registerSessionsRoutes(app, rt);
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

  it('writes idx.activeProfile=plan and idx.permissionMode=default when activeProfile=plan', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        activeProfile: 'plan',
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
        return computePaths(state.cwd, state.sessionId, state.parentSessionId).indexPath;
      })
    );

    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.activeProfile).toBe('plan');
    expect(idx).not.toHaveProperty('mode');
    expect(idx.permissionMode).toBe('default');
  });

  it('writes idx.activeProfile=build and idx.permissionMode=bypass when activeProfile=build+bypass', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        activeProfile: 'build',
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
        return computePaths(state.cwd, state.sessionId, state.parentSessionId).indexPath;
      })
    );

    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.activeProfile).toBe('build');
    expect(idx).not.toHaveProperty('mode');
    expect(idx.permissionMode).toBe('bypass');
  });

  it('allows plan profile with any permissionMode (plan no longer overrides perm)', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        activeProfile: 'plan',
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
        return computePaths(state.cwd, state.sessionId, state.parentSessionId).indexPath;
      })
    );
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.activeProfile).toBe('plan');
    expect(idx).not.toHaveProperty('mode');
    expect(idx.permissionMode).toBe('bypass');
    expect(idx.activeProfile).toBe('plan');
  });

  it('rejects missing model', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, activeProfile: 'build', permissionMode: 'default' }),
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

  it('new session persists activeProfile and permissionMode', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        activeProfile: 'plan',
        permissionMode: 'default',
        model: 'gpt-4',
      }),
    });
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();

    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        expect(state.activeProfile).toBe('plan');
        expect(state).not.toHaveProperty('mode');
        expect(state.permissionMode).toBe('default');
        expect(state.activeProfile).toBe('plan');
      })
    );
  });
});
