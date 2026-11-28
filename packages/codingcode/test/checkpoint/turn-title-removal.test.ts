import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID, createHash } from 'crypto';
import { CheckpointService } from '@codingcode/checkpoint';
import { ShadowGit } from '@codingcode/checkpoint/shadow-git';
import { normalizePath } from '@codingcode/util';
import { useTempProjectBase } from '../helpers/project-base.js';
import { CheckpointLayer } from '@codingcode/checkpoint';

useTempProjectBase();

describe('checkpoint turn title removal', () => {
  it('stores and returns checkpoints without a turn title', async () => {
    const projectPath = join(tmpdir(), `codingcode-${randomUUID()}`);
    const sessionId = 'turn-title-removal';
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, 'before.txt'), 'before', 'utf8');

    try {
      const checkpoints = (await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.ensureBaseline({ target: { cwd: projectPath, sessionId }, turnId: 1 });
          writeFileSync(join(projectPath, 'after.txt'), 'after', 'utf8');
          return yield* checkpoint.getCheckpointDiff({ cwd: projectPath, sessionId });
        }).pipe(Effect.provide(CheckpointLayer) as any)
      )) as { turnId: number; files: Array<{ path: string }> };

      expect(checkpoints.turnId).toBe(1);
      expect(checkpoints.files.map((f) => f.path)).toEqual([
        normalizePath(join(projectPath, 'after.txt')),
      ]);
      expect(checkpoints).not.toHaveProperty('title');

      const shortSid = createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
      const shadowGit = new ShadowGit(projectPath);
      const baselineMessage = shadowGit
        .git('log', '--all', '--grep', `turn-${shortSid}-1-baseline`, '--format=%s', '-1')
        .stdout.trim();
      expect(baselineMessage).toBe(`turn-${shortSid}-1-baseline`);
      expect(readFileSync(join(projectPath, 'after.txt'), 'utf8')).toBe('after');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);
});
