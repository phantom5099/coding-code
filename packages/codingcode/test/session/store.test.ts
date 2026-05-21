import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { randomUUID } from 'crypto';
import { Cause, Effect, Exit } from 'effect';
import { SessionService, findSessionIndex } from '../../src/session/store.js';
import { projectSlugFromPath, normalizePath } from '../../src/core/path.js';
import { AgentError } from '../../src/core/error.js';

const SESSIONS_DIR = join(homedir(), '.codingcode', 'sessions');

describe('SessionService resume workspace', () => {
  let projectA: string;
  let projectB: string;
  let sessionId: string;
  let slugA: string;

  beforeEach(() => {
    sessionId = randomUUID();
    projectA = join(tmpdir(), `sess-a-${randomUUID().slice(0, 8)}`);
    projectB = join(tmpdir(), `sess-b-${randomUUID().slice(0, 8)}`);
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    slugA = projectSlugFromPath(projectA);

    const transcriptPath = join(SESSIONS_DIR, slugA, `${sessionId}.jsonl`);
    const indexPath = transcriptPath.replace('.jsonl', '.index.json');
    mkdirSync(join(SESSIONS_DIR, slugA), { recursive: true });

    const meta = {
      type: 'session_meta',
      sessionId,
      projectSlug: slugA,
      cwd: normalizePath(projectA),
      model: 'test',
      createdAt: new Date().toISOString(),
      version: '0.1.0',
    };
    writeFileSync(transcriptPath, JSON.stringify(meta) + '\n', 'utf8');
    writeFileSync(
      indexPath,
      JSON.stringify({
        sessionId,
        projectSlug: slugA,
        cwd: normalizePath(projectA),
        model: 'test',
        createdAt: meta.createdAt,
        updatedAt: meta.createdAt,
        messageCount: 0,
        title: sessionId.slice(0, 8),
        currentTurnId: 0,
      }, null, 2),
      'utf8',
    );
  });

  afterEach(() => {
    try { rmSync(projectA, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(projectB, { recursive: true, force: true }); } catch { /* ignore */ }
    const transcriptPath = join(SESSIONS_DIR, slugA, `${sessionId}.jsonl`);
    const indexPath = transcriptPath.replace('.jsonl', '.index.json');
    try { rmSync(transcriptPath, { force: true }); } catch { /* ignore */ }
    try { rmSync(indexPath, { force: true }); } catch { /* ignore */ }
    const wrongSlug = projectSlugFromPath(projectB);
    try { rmSync(join(SESSIONS_DIR, wrongSlug, `${sessionId}.jsonl`), { force: true }); } catch { /* ignore */ }
  });

  it('findSessionIndex locates session across project slugs', () => {
    const index = findSessionIndex(sessionId);
    expect(index).not.toBeNull();
    expect(index!.projectSlug).toBe(slugA);
    expect(index!.cwd).toBe(normalizePath(projectA));
  });

  it('create with sessionId succeeds when cwd matches session project', async () => {
    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(projectA, 'test', '0.1.0', sessionId);
      }).pipe(Effect.provide(SessionService.Default)),
    );
    expect(state.sessionId).toBe(sessionId);
    expect(state.messageCount).toBe(0);
  });

  it('create with sessionId throws when cwd is a different project', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(projectB, 'test', '0.1.0', sessionId);
      }).pipe(Effect.provide(SessionService.Default)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const err = Cause.squash((exit as Exit.Failure<unknown, never>).cause);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('SESSION_WORKSPACE_MISMATCH');
  });

  it('listSessions only returns sessions for the given cwd project', async () => {
    const listed = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.listSessions(projectA);
      }).pipe(Effect.provide(SessionService.Default)),
    );
    expect(listed.some((s) => s.sessionId === sessionId)).toBe(true);

    const other = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.listSessions(projectB);
      }).pipe(Effect.provide(SessionService.Default)),
    );
    expect(other.some((s) => s.sessionId === sessionId)).toBe(false);
  });

  it('create with sessionId throws when session does not exist', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(projectA, 'test', '0.1.0', randomUUID());
      }).pipe(Effect.provide(SessionService.Default)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const err = Cause.squash((exit as Exit.Failure<unknown, never>).cause);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('SESSION_NOT_FOUND');
  });
});
