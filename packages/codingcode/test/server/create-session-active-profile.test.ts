import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { computePaths } from '../../src/core/path.js';
import { WorkspaceService } from '../../src/workspace/workspace.js';
import { registerSessionsRoutes } from '../../src/server/routes/sessions.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function makeLayer() {
  return Layer.mergeAll(SessionLayer, WorkspaceService.Default);
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
