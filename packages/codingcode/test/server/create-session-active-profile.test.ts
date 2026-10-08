import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { registerSessionsRoutes } from '../../src/server/routes/sessions.js';
import { registerErrorHandler } from '../../src/server/util.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

describe('POST /api/sessions — atomic mode + permissionMode + model', () => {
  let cwd: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;
  let app: Hono;

  beforeEach(async () => {
    cwd = join(base.dir, 'create-session-active-profile');
    mkdirSync(cwd, { recursive: true });
    rt = ManagedRuntime.make(SessionLayer as any);
    app = new Hono();
    registerErrorHandler(app);
    registerSessionsRoutes(app, rt);
  });

  afterEach(async () => {
    await rt.dispose();
  });

  it('persists activeProfile=plan and permissionMode=ask when activeProfile=plan', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        activeProfile: 'plan',
        permissionMode: 'askBeforeExec',
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
        expect(state.permissionMode).toBe('askBeforeExec');
      })
    );
  });

  it('persists activeProfile=build and permissionMode=bypass when activeProfile=build+bypass', async () => {
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

    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        expect(state.activeProfile).toBe('build');
        expect(state).not.toHaveProperty('mode');
        expect(state.permissionMode).toBe('bypass');
      })
    );
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
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        expect(state.activeProfile).toBe('plan');
        expect(state).not.toHaveProperty('mode');
        expect(state.permissionMode).toBe('bypass');
      })
    );
  });

  it('rejects missing model', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, activeProfile: 'build', permissionMode: 'askBeforeExec' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing mode', async () => {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, permissionMode: 'askBeforeExec', model: 'gpt-4' }),
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
        permissionMode: 'askBeforeExec',
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
        expect(state.permissionMode).toBe('askBeforeExec');
        expect(state.activeProfile).toBe('plan');
      })
    );
  });
});
