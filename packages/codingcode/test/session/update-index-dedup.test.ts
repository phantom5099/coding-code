import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';

import { encodeProjectPath } from '../../src/core/path.js';
import * as fileOps from '../../src/session/file-ops.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('updateIndex writes from state without rereading the index', () => {
  it('recordUser does not reread the index', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    const spy = vi.spyOn(fileOps, 'readCurrentIndex');

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'default',
          });
        })
      );
      spy.mockClear();

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordUser(state, 'hello world');
        })
      );

      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recordAssistant does not reread the index', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    const spy = vi.spyOn(fileOps, 'readCurrentIndex');

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'default',
          });
        })
      );
      spy.mockClear();

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordAssistant(state, 'reply', []);
        })
      );

      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rollbackToTurn does not reread the index', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });

    const spy = vi.spyOn(fileOps, 'readCurrentIndex');

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'test-model',
            activeProfile: 'build',
            permissionMode: 'default',
          });
        })
      );
      spy.mockClear();

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.rollbackToTurn(state, 1, 'test');
        })
      );

      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
