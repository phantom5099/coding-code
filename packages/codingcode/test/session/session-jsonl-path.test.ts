import { describe, it, expect } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';

import { deleteSession } from '../../src/session/file-ops.js';
import { sessionJsonlPathFromCwd } from '../../src/core/path.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('sessionJsonlPathFromCwd', () => {
  it('returns path matching SessionService.create transcriptPath', async () => {
    const cwd = '/tmp/test-jsonl-path';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(cwd, {
          model: 'test-model',
          mode: 'build',
          permissionMode: 'default',
        });
      })
    );

    try {
      const result = sessionJsonlPathFromCwd(cwd, state.sessionId);
      expect(result).toBe(state.transcriptPath);
      expect(existsSync(result)).toBe(true);
    } finally {
      rmSync(join(base.dir, state.projectPath), { recursive: true, force: true });
    }
  });

  it('deleteSession with cwd deletes correct files', async () => {
    const cwd = '/tmp/test-jsonl-delete';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(cwd, {
          model: 'test-model',
          mode: 'build',
          permissionMode: 'default',
        });
      })
    );

    try {
      expect(existsSync(state.transcriptPath)).toBe(true);
      expect(existsSync(state.indexPath)).toBe(true);

      deleteSession(state.sessionId, cwd);

      expect(existsSync(state.transcriptPath)).toBe(false);
      expect(existsSync(state.indexPath)).toBe(false);
    } finally {
      rmSync(join(base.dir, state.projectPath), { recursive: true, force: true });
    }
  });
});
