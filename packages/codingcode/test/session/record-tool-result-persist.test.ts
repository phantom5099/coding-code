import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('recordToolResult', () => {
  it('writes full output for all tool results', async () => {
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create('/tmp/persist-test', 'test-model');
      })
    );

    const longOutput = 'x'.repeat(30000);
    const assistantEvent = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.recordAssistant(state, 'use tool', [
          { id: 'tc1', name: 'bash', arguments: { cmd: 'echo' } },
        ]);
      })
    );

    const event = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.recordToolResult(state, 'bash', 'tc1', longOutput);
      })
    );

    expect(event.output).toBe(longOutput);
    expect(event.output).toHaveLength(30000);
  });

  it('writes full output for small tool results', async () => {
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create('/tmp/persist-test-small', 'test-model');
      })
    );

    const shortOutput = 'small result';
    const assistantEvent = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.recordAssistant(state, 'use tool', [
          { id: 'tc1', name: 'bash', arguments: { cmd: 'echo' } },
        ]);
      })
    );

    const event = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.recordToolResult(state, 'bash', 'tc1', shortOutput);
      })
    );

    expect(event.output).toBe(shortOutput);
  });
});
