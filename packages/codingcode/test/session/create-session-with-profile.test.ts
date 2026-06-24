import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('createSessionWithProfile helper', () => {
  it('modeToProfile default activeProfile when not overridden', async () => {
    const cwd = '/tmp/test-cswp-default';
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
    expect(state.activeProfile).toBe('plan');
  });

  it('explicit activeProfile in opts overrides modeToProfile default', async () => {
    const cwd = '/tmp/test-cswp-override';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.createSessionWithProfile(
          cwd,
          { model: 'gpt-4o', mode: 'build', permissionMode: 'default' },
          { activeProfile: 'explore' }
        );
      })
    );
    expect(state.activeProfile).toBe('explore');
    expect(state.mode).toBe('build');
  });
});

describe('setSessionProfile 5th param removed', () => {
  it('runtime/project-runtime.ts no longer accepts _parentSessionId in setSessionProfile', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/runtime/project-runtime.ts',
      'utf8'
    );
    expect(src).not.toMatch(/_parentSessionId\?:/);
  });
});

void base;
