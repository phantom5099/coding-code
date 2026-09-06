import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { Effect } from 'effect';
import { computePaths } from '../../src/core/path.js';
import { SessionService, SessionLayer } from '../../src/session/index.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

function run<T>(effect: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(effect.pipe(Effect.provide(SessionLayer) as any));
}

describe('session activeProfile persistence', () => {
  it('persists the profile supplied at creation without a mode field', async () => {
    const cwd = '/tmp/test-active-profile-create';
    const state = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.create(cwd, {
          model: 'gpt-4o',
          activeProfile: 'plan',
          permissionMode: 'default',
        });
      })
    );

    const paths = computePaths(state.cwd, state.sessionId, state.parentSessionId);
    const index = JSON.parse(readFileSync(paths.indexPath, 'utf8'));

    expect(state.activeProfile).toBe('plan');
    expect(state.sessionMeta?.activeProfile).toBe('plan');
    expect(index.activeProfile).toBe('plan');
    expect(state).not.toHaveProperty('mode');
    expect(index).not.toHaveProperty('mode');
  });

  it('keeps an updated profile when later events rewrite the index', async () => {
    const cwd = '/tmp/test-active-profile-update';
    const state = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.create(cwd, {
          model: 'gpt-4o',
          activeProfile: 'build',
          permissionMode: 'default',
        });
      })
    );

    await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setActiveProfile(state.cwd, state.sessionId, 'plan');
        const reloaded = yield* session.load(state.cwd, state.sessionId);
        yield* session.recordUser(reloaded, 'hello');
      })
    );

    const paths = computePaths(state.cwd, state.sessionId, state.parentSessionId);
    const index = JSON.parse(readFileSync(paths.indexPath, 'utf8'));

    expect(index.activeProfile).toBe('plan');
    expect(index).not.toHaveProperty('mode');
  });
});
