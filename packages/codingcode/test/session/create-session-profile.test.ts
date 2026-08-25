import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

function run<T>(effect: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(effect.pipe(Effect.provide(SessionService.Default) as any));
}

describe('SessionService.create profile', () => {
  it('uses activeProfile as the only agent profile field', async () => {
    const state = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.create('/tmp/test-session-profile', {
          model: 'gpt-4o',
          activeProfile: 'build',
          permissionMode: 'default',
        });
      })
    );

    expect(state.activeProfile).toBe('build');
    expect(state).not.toHaveProperty('mode');
  });
});
