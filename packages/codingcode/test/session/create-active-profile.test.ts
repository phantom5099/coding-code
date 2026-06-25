import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { encodeProjectPath } from '../../src/core/path.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('create writes activeProfile in one updateIndex', () => {
  it('top-level create with explicit activeProfile writes once, no separate setActiveProfile IO', async () => {
    const cwd = '/tmp/test-active-profile-once';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.createSessionWithProfile(
          cwd,
          { model: 'gpt-4o', mode: 'build', permissionMode: 'default' },
          { activeProfile: 'custom-profile' }
        );
      })
    );

    const idx = JSON.parse(readFileSync(state.indexPath, 'utf8'));
    expect(idx.activeProfile).toBe('custom-profile');
    expect(idx.mode).toBe('build');
    expect(idx.permissionMode).toBe('default');
    void base;
    void randomUUID;
    void join;
    void encodeProjectPath;
  });

  it('create without activeProfile in opts falls back to modeToProfile default', async () => {
    const cwd = '/tmp/test-active-profile-default';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.createSessionWithProfile(cwd, {
          model: 'gpt-4o',
          mode: 'plan',
          permissionMode: 'default',
        });
      })
    );

    const idx = JSON.parse(readFileSync(state.indexPath, 'utf8'));
    expect(idx.activeProfile).toBe('plan');
    expect(idx.mode).toBe('plan');
  });

  it('switch profile via setActiveProfile then record preserves new activeProfile (no stale overwrite)', async () => {
    const cwd = '/tmp/test-active-profile-switch';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.createSessionWithProfile(cwd, {
          model: 'gpt-4o',
          mode: 'build',
          permissionMode: 'default',
        });
      })
    );

    await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        yield* svc.setActiveProfile(cwd, state.sessionId, 'explore');
      })
    );

    const after = JSON.parse(readFileSync(state.indexPath, 'utf8'));
    expect(after.activeProfile).toBe('explore');

    await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        yield* svc.recordUser(state, 'hello');
      })
    );

    const afterRecord = JSON.parse(readFileSync(state.indexPath, 'utf8'));
    expect(afterRecord.activeProfile).toBe('explore');
  });
});
