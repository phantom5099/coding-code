import { describe, it, expect } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import {
  computePaths,
  sessionJsonlPathFromCwd,
  projectSessionsDir,
} from '../../src/session/file-ops.js';
import { normalizePath, encodeProjectPath } from '../../src/core/path.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('computePaths', () => {
  it('top-level: returns path matching sessionJsonlPathFromCwd', () => {
    const cwd = '/tmp/test-compute-top-level';
    const sid = randomUUID();
    const result = computePaths(cwd, sid);

    expect(result.transcriptPath).toBe(sessionJsonlPathFromCwd(cwd, sid));
    expect(result.indexPath).toBe(result.transcriptPath.replace('.jsonl', '.index.json'));
    expect(result.sessionId).toBe(sid);
    expect(result.cwd).toBe(normalizePath(cwd));
    expect(result.projectPath).toBe(encodeProjectPath(normalizePath(cwd)));
  });

  it('subagent: path nested under parentSessionId/subagents/', () => {
    const cwd = '/tmp/test-compute-subagent';
    const sid = randomUUID();
    const parentSid = randomUUID();
    const result = computePaths(cwd, sid, parentSid);

    const sessionsDir = projectSessionsDir(encodeProjectPath(normalizePath(cwd)));
    const expectedTranscript = join(sessionsDir, parentSid, 'subagents', `${sid}.jsonl`);
    expect(result.transcriptPath).toBe(expectedTranscript);
    expect(result.indexPath).toBe(expectedTranscript.replace('.jsonl', '.index.json'));
    expect(result.sessionId).toBe(sid);
  });

  it('e2e: SessionService.create returns state.transcriptPath matching computePaths', async () => {
    const cwd = '/tmp/test-compute-e2e-top';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(cwd, 'test-model');
      })
    );

    try {
      const expected = computePaths(cwd, state.sessionId);
      expect(state.transcriptPath).toBe(expected.transcriptPath);
      expect(state.indexPath).toBe(expected.indexPath);
      expect(state.projectPath).toBe(expected.projectPath);
      expect(state.cwd).toBe(expected.cwd);
      expect(existsSync(state.transcriptPath)).toBe(true);
    } finally {
      rmSync(join(base.dir, state.projectPath), { recursive: true, force: true });
    }
  });

  it('e2e: create with parentSessionId writes file at nested subagent path', async () => {
    const cwd = '/tmp/test-compute-e2e-sub';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(cwd, 'test-model');
      })
    );

    try {
      const childState = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(cwd, 'subagent-model', {
            parentSessionId: state.sessionId,
          });
        })
      );

      try {
        const expected = computePaths(cwd, childState.sessionId, state.sessionId);
        expect(childState.transcriptPath).toBe(expected.transcriptPath);
        expect(childState.indexPath).toBe(expected.indexPath);
        expect(childState.projectPath).toBe(expected.projectPath);
        expect(existsSync(childState.transcriptPath)).toBe(true);
        expect(existsSync(childState.indexPath)).toBe(true);
      } finally {
        rmSync(join(base.dir, childState.projectPath), { recursive: true, force: true });
      }
    } finally {
      rmSync(join(base.dir, state.projectPath), { recursive: true, force: true });
    }
  });
});
