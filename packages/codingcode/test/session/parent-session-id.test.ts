import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '@codingcode/session';
import { SessionLayer } from '@codingcode/session';
import { computePaths } from '@codingcode/session';
import { readSessionMeta } from '@codingcode/session';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

describe('parentSessionId in session head', () => {
  it('writes parentSessionId to the session head when passed to create opts', async () => {
    const cwd = '/tmp/test-parent-session-id';
    const parentId = '00000000-0000-0000-0000-000000000001';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create({
          cwd,
          model: 'gpt-4o',
          permissionMode: 'askBeforeExec',
          lineage: { parentSessionId: parentId },
        });
      })
    );

    const meta = readSessionMeta(computePaths(state).transcriptPath);
    expect(meta?.parentSessionId).toBe(parentId);
    expect(meta?.sessionId).toBe(state.sessionId);
  });
});
