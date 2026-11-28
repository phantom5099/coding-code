import { describe, it, expect } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { SessionService } from '@codingcode/session';
import { SessionLayer } from '@codingcode/session';

import { deleteSession } from '@codingcode/session/file-ops';
import { computePaths, transcriptPathOf } from '@codingcode/session';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

describe('transcriptPathOf', () => {
  it('returns path matching SessionService.create transcriptPath', async () => {
    const cwd = '/tmp/test-jsonl-path';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create({
          cwd,
          model: 'test-model',
          permissionMode: 'askBeforeExec',
        });
      })
    );

    try {
      const result = transcriptPathOf({ cwd, sessionId: state.sessionId });
      expect(result).toBe(computePaths(state).transcriptPath);
      expect(existsSync(result)).toBe(true);
    } finally {
      rmSync(join(base.dir, computePaths(state).projectPath), { recursive: true, force: true });
    }
  });

  it('deleteSession with cwd deletes correct files', async () => {
    const cwd = '/tmp/test-jsonl-delete';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create({
          cwd,
          model: 'test-model',
          permissionMode: 'askBeforeExec',
        });
      })
    );

    try {
      expect(existsSync(computePaths(state).transcriptPath)).toBe(true);

      deleteSession({ cwd, sessionId: state.sessionId });

      expect(existsSync(computePaths(state).transcriptPath)).toBe(false);
    } finally {
      rmSync(join(base.dir, computePaths(state).projectPath), { recursive: true, force: true });
    }
  });
});
