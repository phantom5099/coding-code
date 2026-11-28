import { describe, it, expect } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '@codingcode/session';
import { SessionLayer } from '@codingcode/session';
import { computePaths, projectSessionsDir, transcriptPathOf } from '@codingcode/session';
import { normalizePath, encodeProjectPath } from '@codingcode/util';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

describe('computePaths', () => {
  it('top-level: returns path matching transcriptPathOf', () => {
    const cwd = '/tmp/test-compute-top-level';
    const sid = randomUUID();
    const result = computePaths({ cwd, sessionId: sid });

    expect(result.transcriptPath).toBe(transcriptPathOf({ cwd, sessionId: sid }));
    expect(result.sessionId).toBe(sid);
    expect(result.cwd).toBe(normalizePath(cwd));
    expect(result.projectPath).toBe(encodeProjectPath(normalizePath(cwd)));
  });

  it('subagent: path nested under parentSessionId/subagents/', () => {
    const cwd = '/tmp/test-compute-subagent';
    const sid = randomUUID();
    const parentSid = randomUUID();
    const result = computePaths({ cwd, sessionId: sid, parentSessionId: parentSid });

    const sessionsDir = projectSessionsDir(cwd);
    const expectedTranscript = join(sessionsDir, parentSid, 'subagents', `${sid}.jsonl`);
    expect(result.transcriptPath).toBe(expectedTranscript);
    expect(result.sessionId).toBe(sid);
  });

  it('e2e: SessionService.create returns computePaths(state).transcriptPath matching computePaths', async () => {
    const cwd = '/tmp/test-compute-e2e-top';
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
      const expected = computePaths({ cwd, sessionId: state.sessionId });
      expect(computePaths(state).transcriptPath).toBe(expected.transcriptPath);
      expect(computePaths(state).projectPath).toBe(expected.projectPath);
      expect(state.cwd).toBe(expected.cwd);
      expect(existsSync(computePaths(state).transcriptPath)).toBe(true);
    } finally {
      rmSync(join(base.dir, computePaths(state).projectPath), { recursive: true, force: true });
    }
  });

  it('e2e: create with parentSessionId writes file at nested subagent path', async () => {
    const cwd = '/tmp/test-compute-e2e-sub';
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
      const childState = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create({
            cwd,
            model: 'subagent-model',
            permissionMode: 'askBeforeExec',
            lineage: { parentSessionId: state.sessionId },
          });
        })
      );

      try {
        const expected = computePaths({
          cwd,
          sessionId: childState.sessionId,
          parentSessionId: state.sessionId,
        });
        const actual = computePaths(childState);
        expect(actual).toEqual(expected);
        expect(existsSync(actual.transcriptPath)).toBe(true);
        expect(childState).not.toHaveProperty('projectPath');
        expect(childState).not.toHaveProperty('transcriptPath');
        expect(childState).not.toHaveProperty('indexPath');
        expect(childState).not.toHaveProperty('mode');
      } finally {
        const paths = computePaths(childState);
        rmSync(join(base.dir, paths.projectPath), { recursive: true, force: true });
      }
    } finally {
      rmSync(join(base.dir, computePaths(state).projectPath), { recursive: true, force: true });
    }
  });
});
