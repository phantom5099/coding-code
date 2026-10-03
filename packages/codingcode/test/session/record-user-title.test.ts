import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { encodeProjectPath } from '../../src/core/path.js';
import { computePaths } from '../../src/session/paths.js';
import { readSessionMeta } from '../../src/session/file-ops.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

function cleanup(dir: string) {
  rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}

function newDir(): string {
  const dir = join(base.dir, randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function metaOf(cwd: string, sessionId: string, parentSessionId?: string) {
  return readSessionMeta(computePaths(cwd, sessionId, parentSessionId).transcriptPath);
}

describe('title persistence — backfilled from the first user message', () => {
  it('create without an explicit title persists an empty title (no id placeholder)', async () => {
    const dir = newDir();
    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'ask',
          });
        })
      );

      expect(created.title).toBe('');
      expect(metaOf(dir, created.sessionId)?.title).toBe('');
    } finally {
      cleanup(dir);
    }
  });

  it('first recordUser derives and persists a title from the user message', async () => {
    const dir = newDir();
    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'ask',
          });
        })
      );

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.recordUser(state, 'fix the login bug');
        })
      );

      expect(metaOf(dir, created.sessionId)?.title).toBe('fix the login bug');
    } finally {
      cleanup(dir);
    }
  });

  it('collapses newlines and truncates long content', async () => {
    const dir = newDir();
    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'ask',
          });
        })
      );

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.recordUser(state, `${'a'.repeat(40)}\nsecond line`);
        })
      );

      expect(metaOf(dir, created.sessionId)?.title).toBe(`${'a'.repeat(30)}...`);
    } finally {
      cleanup(dir);
    }
  });

  it('later user messages do not overwrite the already-set title', async () => {
    const dir = newDir();
    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'ask',
          });
        })
      );

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.recordUser(state, 'first message');
        })
      );
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.recordUser(state, 'second message should not win');
        })
      );

      expect(metaOf(dir, created.sessionId)?.title).toBe('first message');
    } finally {
      cleanup(dir);
    }
  });

  it('an explicit title passed to create is never overwritten by the first message', async () => {
    const dir = newDir();
    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            title: 'explicit title',
            activeProfile: 'build',
            permissionMode: 'ask',
          });
        })
      );

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.recordUser(state, 'a totally different message');
        })
      );

      expect(metaOf(dir, created.sessionId)?.title).toBe('explicit title');
    } finally {
      cleanup(dir);
    }
  });

  it('a user rename is preserved against auto-backfill', async () => {
    const dir = newDir();
    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'ask',
          });
        })
      );

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.renameSession(state, 'my custom name');
          yield* svc.recordUser(state, 'first message');
        })
      );

      expect(metaOf(dir, created.sessionId)?.title).toBe('my custom name');
    } finally {
      cleanup(dir);
    }
  });
});
