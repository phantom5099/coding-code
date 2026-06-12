import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { encodeProjectPath } from '../../src/core/path.js';
import * as io from '../../src/session/io.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('updateIndex deduplication after removing appendEvent', () => {
  it('recordUser calls enqueueWrite exactly once', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });

    const spy = vi.spyOn(io, 'enqueueWrite');

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'test-model');
        })
      );
      spy.mockClear();

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordUser(state, 'hello world');
        })
      );

      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recordAssistant calls enqueueWrite exactly once', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });

    const spy = vi.spyOn(io, 'enqueueWrite');

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'test-model');
        })
      );
      spy.mockClear();

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordAssistant(state, 'reply', [], 'test-model');
        })
      );

      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hideMessage calls enqueueWrite exactly once', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });

    const spy = vi.spyOn(io, 'enqueueWrite');

    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'test-model');
        })
      );
      spy.mockClear();

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.hideMessage(state, 'dummy-uuid', 'test');
        })
      );

      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
