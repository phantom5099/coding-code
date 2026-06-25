import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { encodeProjectPath } from '../../src/core/path.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('parentSessionId in index.json', () => {
  it('write parentSessionId to index.json when passed to create opts', async () => {
    const cwd = '/tmp/test-parent-session-id';
    const parentId = '00000000-0000-0000-0000-000000000001';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(
          cwd,
          { model: 'gpt-4o', mode: 'build', permissionMode: 'default' },
          { parentSessionId: parentId }
        );
      })
    );

    const idxRaw = readFileSync(state.indexPath, 'utf8');
    const idx = JSON.parse(idxRaw);
    expect(idx.parentSessionId).toBe(parentId);
    expect(idx.sessionId).toBe(state.sessionId);

    const projectDir = join(base.dir, encodeProjectPath(cwd));
    void projectDir;
  });
});
