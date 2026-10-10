import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { encodeProjectPath } from '../../src/util/path.js';
import { computePaths } from '../../src/session/paths.js';
import { readSessionMeta } from '../../src/session/file-ops.js';
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

function newDir(): string {
  const dir = join(base.dir, randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

const create = (dir: string) =>
  Effect.gen(function* () {
    const svc = yield* SessionService;
    return yield* svc.create(dir, {
      model: 'test-model',
      activeProfile: 'build',
      permissionMode: 'askBeforeExec',
    });
  });

describe('recordUserInput — steer input lands under the current turnId', () => {
  it('persists a source:"user" event without bumping turnId', async () => {
    const dir = newDir();
    try {
      const created = await run(create(dir));
      const res = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          // 先落一条常规用户消息，建立 turnId=1
          yield* svc.recordUser(state, text('first turn'));
          const before = state.currentTurnId;
          const ev = yield* svc.recordUserInput(state, text('steer me'));
          return { before, after: state.currentTurnId, ev };
        })
      );

      expect(res.ev.source).toBe('user');
      expect(res.ev.turnId).toBe(res.before);
      expect(res.after).toBe(res.before);
      expect(res.ev.content).toEqual(text('steer me'));
    } finally {
      cleanup(dir);
    }
  });

  it('does not overwrite the title derived from the first message', async () => {
    const dir = newDir();
    try {
      const created = await run(create(dir));
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.recordUser(state, text('fix the login bug'));
          yield* svc.recordUserInput(state, text('a steer that must not become the title'));
        })
      );

      expect(readSessionMeta(computePaths(dir, created.sessionId).transcriptPath)?.title).toBe(
        'fix the login bug'
      );
    } finally {
      cleanup(dir);
    }
  });

  it('derives a title from the steer input when none was set yet', async () => {
    const dir = newDir();
    try {
      const created = await run(create(dir));
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.recordUserInput(state, text('first thing said is a steer'));
        })
      );

      expect(readSessionMeta(computePaths(dir, created.sessionId).transcriptPath)?.title).toBe(
        'first thing said is a steer'
      );
    } finally {
      cleanup(dir);
    }
  });

  it('recordUser still bumps turnId for the next turn after a steer', async () => {
    const dir = newDir();
    try {
      const created = await run(create(dir));
      const res = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.recordUser(state, text('turn one'));
          const afterOne = state.currentTurnId;
          yield* svc.recordUserInput(state, text('steer'));
          const afterSteer = state.currentTurnId;
          yield* svc.recordUser(state, text('turn two'));
          return { afterOne, afterSteer, afterTwo: state.currentTurnId };
        })
      );

      expect(res.afterSteer).toBe(res.afterOne);
      expect(res.afterTwo).toBe(res.afterOne + 1);
    } finally {
      cleanup(dir);
    }
  });

  it('the steer event is visible via readUITurns with content matching the parts', async () => {
    const dir = newDir();
    try {
      const created = await run(create(dir));
      const parts = text('steer with parts');
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.load(dir, created.sessionId);
          yield* svc.recordUser(state, text('turn one'));
          yield* svc.recordUserInput(state, parts);
        })
      );

      const turns = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.readUITurns(created.sessionId, dir);
        })
      );

      const items = turns.flatMap((t) => t.items);
      const steer = items.filter((i) => i.type === 'message' && i.role === 'user').at(-1)!;
      expect(steer.type).toBe('message');
      if (steer.type !== 'message') throw new Error('expected message');
      expect(steer.parts).toEqual(parts);
    } finally {
      cleanup(dir);
    }
  });
});
