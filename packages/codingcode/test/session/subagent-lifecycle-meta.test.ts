import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '@codingcode/session';
import { SessionLayer } from '@codingcode/session';
import { computePaths } from '@codingcode/session';
import { readSessionMeta } from '@codingcode/session';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase('codingcode-test-subagent-meta-');

const PARENT = '00000000-0000-0000-0000-0000000000a1';

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

const childOpts = {
  model: 'gpt-4o',

  permissionMode: 'askBeforeExec' as const,
};

describe('subagent identity persisted in the session head', () => {
  it('子会话写入 description 与 systemPrompt，两者都能从会话头读回', async () => {
    const cwd = '/tmp/test-subagent-meta-write';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create({
          cwd,
          ...childOpts,
          lineage: { parentSessionId: PARENT },
          subagent: {
            agentName: 'reviewer',
            description: 'reviews the diff',
            systemPrompt: 'CUSTOM-MIDDLE-MARKER',
          },
        });
      })
    );

    const meta = readSessionMeta(computePaths(state).transcriptPath);
    expect(meta?.parentSessionId).toBe(PARENT);
    expect(meta?.agentName).toBe('reviewer');
    expect(meta?.description).toBe('reviews the diff');
    expect(meta?.systemPrompt).toBe('CUSTOM-MIDDLE-MARKER');
  });

  it('主会话（无 parentSessionId）即使传入 systemPrompt 也不落盘', async () => {
    const cwd = '/tmp/test-subagent-meta-root';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create({
          cwd,
          ...childOpts,
          subagent: { systemPrompt: 'SHOULD-NOT-PERSIST' },
        });
      })
    );

    const meta = readSessionMeta(computePaths(state).transcriptPath);
    expect(meta?.systemPrompt).toBeUndefined();
    expect(meta?.parentSessionId).toBeUndefined();
  });

  it('description 缺省时不写该字段', async () => {
    const cwd = '/tmp/test-subagent-meta-absent';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create({
          cwd,
          ...childOpts,
          lineage: { parentSessionId: PARENT },
          subagent: { agentName: 'worker' },
        });
      })
    );

    const meta = readSessionMeta(computePaths(state).transcriptPath);
    expect(meta?.description).toBeUndefined();
    expect(meta?.systemPrompt).toBeUndefined();
  });
});
