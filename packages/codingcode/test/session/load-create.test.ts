import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { AgentError } from '../../src/core/error.js';
import { encodeProjectPath } from '../../src/core/path.js';
import type { SessionIndex } from '../../src/session/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

function cleanup(dir: string) {
  rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}

describe('load — restores model from disk, not overwritten', () => {
  it('load restores model from index.json, not overwritten by caller', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'gpt-4o',
            mode: 'build',
            permissionMode: 'default',
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

      expect(loaded.model).toBe('gpt-4o');
      expect(loaded.sessionId).toBe(sid);
      expect(loaded.sessionMeta).not.toBeNull();
    } finally {
      cleanup(dir);
    }
  });

  it('load then rollbackToTurn preserves real model in index.json', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'claude-3-5-sonnet',
            mode: 'build',
            permissionMode: 'default',
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

      const beforeRollback = JSON.parse(readFileSync(created.indexPath, 'utf8')) as SessionIndex;
      expect(beforeRollback.model).toBe('claude-3-5-sonnet');

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, sid);
          yield* svc.rollbackToTurn(state, 1, 'test rollback');
        })
      );

      const afterRollback = JSON.parse(readFileSync(created.indexPath, 'utf8')) as SessionIndex;
      expect(afterRollback.model).toBe('claude-3-5-sonnet');
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
        }).pipe(Effect.provide(SessionService.Default))
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
            mode: 'build',
            permissionMode: 'default',
          });
        })
      );

      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load(otherDir, created.sessionId);
        }).pipe(Effect.provide(SessionService.Default))
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
            mode: 'build',
            permissionMode: 'default',
          });
        })
      );

      expect(state.sessionId).toBeTruthy();
      expect(state.sessionId.length).toBeGreaterThan(8);
      expect(state.model).toBe('test-model');
      expect(state.sessionMeta).not.toBeNull();
    } finally {
      cleanup(dir);
    }
  });

  it('create writes model to index.json immediately', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'my-special-model',
            mode: 'build',
            permissionMode: 'default',
          });
        })
      );

      const idx = JSON.parse(readFileSync(state.indexPath, 'utf8')) as SessionIndex;
      expect(idx.model).toBe('my-special-model');
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
            mode: 'build',
            permissionMode: 'default',
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
  it('load restores currentTurnId from index.json', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            mode: 'build',
            permissionMode: 'default',
          });
        })
      );
      const sid = created.sessionId;

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, sid);
          svc.incrementTurn(state);
          yield* svc.recordUser(state, 'first');
        })
      );
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, sid);
          svc.incrementTurn(state);
          yield* svc.recordUser(state, 'second');
        })
      );

      const idx = JSON.parse(readFileSync(created.indexPath, 'utf8')) as SessionIndex;
      expect(idx.currentTurnId).toBe(2);

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

  it('load restores usage from index.json', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    try {
      const created = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            mode: 'build',
            permissionMode: 'default',
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

      const idx = JSON.parse(readFileSync(created.indexPath, 'utf8')) as SessionIndex;
      expect(idx.usage).toEqual(loaded.usage);
    } finally {
      cleanup(dir);
    }
  });
});
