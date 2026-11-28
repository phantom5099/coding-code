import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '@codingcode/session';
import { SessionLayer } from '@codingcode/session';
import { encodeProjectPath } from '@codingcode/util';
import { computePaths } from '@codingcode/session';
import { readSessionMeta } from '@codingcode/session';
import { useTempProjectBase } from '../helpers/project-base.js';
import { text } from '../helpers/parts.js';

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
          return yield* svc.create({
            cwd: dir,
            model: 'gpt-4o',
            permissionMode: 'askBeforeExec',
          });
        })
      );
      const sid = created.sessionId;

      const loaded = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load({ cwd: dir, sessionId: sid });
        })
      );

      expect(loaded.sessionId).toBe(sid);

      const meta = readSessionMeta(computePaths(created).transcriptPath);
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
          return yield* svc.create({
            cwd: dir,
            model: 'claude-3-5-sonnet',
            permissionMode: 'askBeforeExec',
          });
        })
      );
      const sid = created.sessionId;

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load({ cwd: dir, sessionId: sid });
          yield* svc.recordUser(state, text('first message'));
        })
      );

      const transcriptPath = computePaths(created).transcriptPath;
      expect(readSessionMeta(transcriptPath)?.model).toBe('claude-3-5-sonnet');

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load({ cwd: dir, sessionId: sid });
          yield* svc.rollbackToTurn(state, { throughTurnId: 1, reason: 'test rollback' });
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
          return yield* svc.load({ cwd: dir, sessionId: 'nonexistent-session-id' });
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
          return yield* svc.create({
            cwd: dir,
            model: 'gpt-4o',
            permissionMode: 'askBeforeExec',
          });
        })
      );

      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load({ cwd: otherDir, sessionId: created.sessionId });
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
          return yield* svc.create({
            cwd: dir,
            model: 'test-model',
            permissionMode: 'askBeforeExec',
          });
        })
      );

      expect(state.sessionId).toBeTruthy();
      expect(state.sessionId.length).toBeGreaterThan(8);
      expect(state.model).toBe('test-model');
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
          return yield* svc.create({
            cwd: dir,
            model: 'my-special-model',
            permissionMode: 'askBeforeExec',
          });
        })
      );

      const meta = readSessionMeta(computePaths(state).transcriptPath);
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
          return yield* svc.create({
            cwd: dir,
            model: 'test-model',
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
          return yield* svc.create({
            cwd: dir,
            model: 'test-model',
            permissionMode: 'askBeforeExec',
          });
        })
      );
      const sid = created.sessionId;

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load({ cwd: dir, sessionId: sid });
          yield* svc.recordUser(state, text('first'));
        })
      );
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load({ cwd: dir, sessionId: sid });
          yield* svc.recordUser(state, text('second'));
        })
      );

      const loaded = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load({ cwd: dir, sessionId: sid });
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
          return yield* svc.create({
            cwd: dir,
            model: 'test-model',
            permissionMode: 'askBeforeExec',
          });
        })
      );
      const sid = created.sessionId;

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load({ cwd: dir, sessionId: sid });
          yield* svc.recordUser(state, text('hello'));
          yield* svc.recordAssistant(state, {
            content: 'world',
            toolCalls: [{ id: 'tc1', name: 'bash', arguments: { cmd: 'echo' } }],
          });
        })
      );

      const loaded = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.load({ cwd: dir, sessionId: sid });
        })
      );

      expect(loaded.usage).toBeUndefined();
    } finally {
      cleanup(dir);
    }
  });
});
