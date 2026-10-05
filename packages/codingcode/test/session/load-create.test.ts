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

describe('load — keeps the persisted model untouched', () => {
  it('load does not overwrite model in the session head', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'gpt-4o',
            activeProfile: 'build',
            permissionMode: 'askBeforeExec',
          });
        })
      );
      const sid = created.sessionId;

      const loaded = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load(dir, sid);
        })
      );

      expect(loaded.sessionId).toBe(sid);

      const meta = readSessionMeta(
        computePaths(created.cwd, created.sessionId, created.parentSessionId).transcriptPath
      );
      expect(meta?.model).toBe('gpt-4o');
    } finally {
      cleanup(dir);
    }
  });

  it('load then rollbackToTurn preserves real model in the session head', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'claude-3-5-sonnet',
            activeProfile: 'build',
            permissionMode: 'askBeforeExec',
          });
        })
      );
      const sid = created.sessionId;

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, sid);
          yield* svc.recordUser(state, 'first message');
        })
      );

      const transcriptPath = computePaths(
        created.cwd,
        created.sessionId,
        created.parentSessionId
      ).transcriptPath;
      expect(readSessionMeta(transcriptPath)?.model).toBe('claude-3-5-sonnet');

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, sid);
          yield* svc.rollbackToTurn(state, 1, 'test rollback');
        })
      );

      expect(readSessionMeta(transcriptPath)?.model).toBe('claude-3-5-sonnet');
    } finally {
      cleanup(dir);
    }
  });

  it('load nonexistent session fails with SESSION_NOT_FOUND', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load(dir, 'nonexistent-session-id');
        }).pipe(Effect.provide(SessionLayer))
      );

      expect(exit._tag).toBe('Failure');
      if (exit._tag === 'Failure') {
        const msg = String(exit.cause);
        expect(msg).toContain('SESSION_NOT_FOUND');
      }
    } finally {
      cleanup(dir);
    }
  });

  it('load mismatched workspace fails with SESSION_WORKSPACE_MISMATCH', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });
    const otherDir = join(base.dir, randomUUID());
    mkdirSync(otherDir, { recursive: true });

    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'gpt-4o',
            activeProfile: 'build',
            permissionMode: 'askBeforeExec',
          });
        })
      );

      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load(otherDir, created.sessionId);
        }).pipe(Effect.provide(SessionLayer))
      );

      expect(exit._tag).toBe('Failure');
      if (exit._tag === 'Failure') {
        const msg = String(exit.cause);
        expect(msg).toContain('SESSION_NOT_FOUND');
      }
    } finally {
      cleanup(dir);
      cleanup(otherDir);
    }
  });
});

describe('create — generates sessionId internally', () => {
  it('create without sessionId generates a new UUID', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'askBeforeExec',
          });
        })
      );

      expect(state.sessionId).toBeTruthy();
      expect(state.sessionId.length).toBeGreaterThan(8);
      expect(state.type).toBe('session_meta');
    } finally {
      cleanup(dir);
    }
  });

  it('create writes model to the session head immediately', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'my-special-model',
            activeProfile: 'build',
            permissionMode: 'askBeforeExec',
          });
        })
      );

      const meta = readSessionMeta(
        computePaths(state.cwd, state.sessionId, state.parentSessionId).transcriptPath
      );
      expect(meta?.model).toBe('my-special-model');
    } finally {
      cleanup(dir);
    }
  });

  it('create returns default values for persisted fields', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'askBeforeExec',
          });
        })
      );

      expect(state.currentTurnId).toBe(0);
      expect(state.usage).toBeUndefined();
      expect(state.memorySnapshot).toBe('');
    } finally {
      cleanup(dir);
    }
  });
});

describe('load restores persisted fields', () => {
  it('load restores currentTurnId from the transcript tail', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'askBeforeExec',
          });
        })
      );
      const sid = created.sessionId;

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, sid);
          yield* svc.recordUser(state, 'first');
        })
      );
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, sid);
          yield* svc.recordUser(state, 'second');
        })
      );

      const loaded = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load(dir, sid);
        })
      );

      expect(loaded.currentTurnId).toBe(2);
    } finally {
      cleanup(dir);
    }
  });

  it('load restores usage from the transcript tail', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'askBeforeExec',
          });
        })
      );
      const sid = created.sessionId;

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, sid);
          yield* svc.recordUser(state, 'hello');
          yield* svc.recordAssistant(state, 'world', [
            { id: 'tc1', name: 'bash', arguments: { cmd: 'echo' } },
          ]);
        })
      );

      const loaded = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load(dir, sid);
        })
      );

      expect(loaded.usage).toBeUndefined();
    } finally {
      cleanup(dir);
    }
  });
});
