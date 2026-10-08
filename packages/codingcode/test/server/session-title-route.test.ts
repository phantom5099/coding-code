import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, ManagedRuntime } from 'effect';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { createServer, type ServerApp } from '../../src/server/index.js';
import { computePaths } from '../../src/session/paths.js';
import { readSessionMeta } from '../../src/session/file-ops.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

describe('PUT /api/sessions/:id/title', () => {
  let cwd: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;
  let app: ServerApp;

  beforeEach(async () => {
    cwd = join(base.dir, 'session-title-route');
    mkdirSync(cwd, { recursive: true });
    rt = ManagedRuntime.make(SessionLayer as any);
    app = await createServer(rt);
  });

  afterEach(async () => {
    await rt.dispose();
  });

  async function createSession(): Promise<string> {
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        activeProfile: 'build',
        permissionMode: 'askBeforeExec',
        model: 'gpt-4',
      }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).sessionId;
  }

  async function headTitle(sessionId: string): Promise<string | undefined> {
    return rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        const paths = computePaths(state.cwd, state.sessionId, state.parentSessionId);
        return readSessionMeta(paths.transcriptPath)?.title;
      }) as any
    );
  }

  it('persists a user-provided title to the session head', async () => {
    const sessionId = await createSession();

    const res = await app.request(`/api/sessions/${sessionId}/title`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, title: '我的自定义标题' }),
    });

    expect(res.status).toBe(200);
    expect(await headTitle(sessionId)).toBe('我的自定义标题');
  });

  it('overrides the title auto-derived from the first user message', async () => {
    const sessionId = await createSession();

    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        yield* session.recordUser(state, 'first message');
      })
    );
    expect(await headTitle(sessionId)).toBe('first message');

    const res = await app.request(`/api/sessions/${sessionId}/title`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, title: 'renamed by user' }),
    });

    expect(res.status).toBe(200);
    expect(await headTitle(sessionId)).toBe('renamed by user');
  });

  it('collapses newlines in the title', async () => {
    const sessionId = await createSession();

    const res = await app.request(`/api/sessions/${sessionId}/title`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, title: 'line one\nline two' }),
    });

    expect(res.status).toBe(200);
    expect(await headTitle(sessionId)).toBe('line one line two');
  });

  it('rejects a blank title', async () => {
    const sessionId = await createSession();

    const res = await app.request(`/api/sessions/${sessionId}/title`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, title: '   ' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown session', async () => {
    const res = await app.request('/api/sessions/unknown-id/title', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, title: 'x' }),
    });

    expect(res.status).toBe(404);
  });
});
