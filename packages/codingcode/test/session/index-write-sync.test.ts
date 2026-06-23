import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';

import { encodeProjectPath } from '../../src/core/path.js';
import type { SessionIndex } from '../../src/session/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('index write is synchronous', () => {
  it('recordUser immediately updates index file', async () => {
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

      const indexPath = state.indexPath;

      const before = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
      expect(before.messageCount).toBe(1);

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordUser(state, 'hello');
        })
      );

      const after = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
      expect(after.messageCount).toBe(2);
      expect(after.title).toBe('hello');
    } finally {
      rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recordAssistant immediately updates index file', async () => {
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

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordUser(state, 'hello');
        })
      );

      const indexPath = state.indexPath;

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordAssistant(state, 'reply', [
            { id: 'tc1', name: 'bash', arguments: { cmd: 'echo' } },
          ]);
        })
      );

      const updated = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
      expect(updated.messageCount).toBe(3);
    } finally {
      rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
