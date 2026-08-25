import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID, createHash } from 'crypto';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';
import { ShadowGit } from '../../src/checkpoint/shadow-git.js';
import { normalizePath } from '../../src/core/path.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

describe('checkpoint turn title removal', () => {
  it('stores and returns checkpoints without a turn title', async () => {
    const projectPath = join(tmpdir(), `codingcode-${randomUUID()}`);
    const sessionId = 'turn-title-removal';
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, 'before.txt'), 'before', 'utf8');

    try {
      const checkpoints = await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.snapshotBaseline(projectPath, sessionId, 1);
          writeFileSync(join(projectPath, 'after.txt'), 'after', 'utf8');
          yield* checkpoint.snapshotFinal(projectPath, sessionId, 1);
          return yield* checkpoint.getCheckpoints(projectPath, sessionId);
        }).pipe(Effect.provide(CheckpointService.Default))
      );

      expect(checkpoints).toEqual([
        {
          turnId: 1,
          files: [normalizePath(join(projectPath, 'after.txt'))],
        },
      ]);
      expect(checkpoints[0]).not.toHaveProperty('title');

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
  }, 15000);
});
