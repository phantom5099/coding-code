import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { computePaths } from '../../src/session/paths.js';
import { readSessionMeta, readHistory } from '../../src/session/file-ops.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase('codingcode-test-subagent-meta-');

const PARENT = '00000000-0000-0000-0000-0000000000a1';

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

const childOpts = {
  model: 'gpt-4o',
  activeProfile: 'build' as const,
  permissionMode: 'askBeforeExec' as const,
};

describe('subagent identity persisted in the session head', () => {
  it('子会话写入 description 与 systemPrompt，两者都能从会话头读回', async () => {
    const cwd = '/tmp/test-subagent-meta-write';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(cwd, childOpts, {
          parentSessionId: PARENT,
          agentName: 'reviewer',
          description: 'reviews the diff',
          systemPrompt: 'CUSTOM-MIDDLE-MARKER',
        });
      })
    );

    const meta = readSessionMeta(
      computePaths(state.cwd, state.sessionId, state.parentSessionId).transcriptPath
    );
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
        return yield* svc.create(cwd, childOpts, { systemPrompt: 'SHOULD-NOT-PERSIST' });
      })
    );

    const meta = readSessionMeta(computePaths(state.cwd, state.sessionId).transcriptPath);
    expect(meta?.systemPrompt).toBeUndefined();
    expect(meta?.parentSessionId).toBeUndefined();
  });

  it('description 缺省时不写该字段', async () => {
    const cwd = '/tmp/test-subagent-meta-absent';
    const state = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.create(cwd, childOpts, { parentSessionId: PARENT, agentName: 'worker' });
      })
    );

    const meta = readSessionMeta(
      computePaths(state.cwd, state.sessionId, state.parentSessionId).transcriptPath
    );
    expect(meta?.description).toBeUndefined();
    expect(meta?.systemPrompt).toBeUndefined();
  });
});

describe('recordSubagentMessage', () => {
  it('落盘一条 subagent_message 事件，形状正确且不推进 turnId', async () => {
    const cwd = '/tmp/test-subagent-message';
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        const state = yield* svc.create(cwd, childOpts);
        const before = state.currentTurnId;
        const event = yield* svc.recordSubagentMessage(state, {
          sessionId: 'child-1',
          agentName: 'build',
          content: 'Message Type: INTER_AGENT_MESSAGE\nfrom root\nhi',
        });
        return { before, after: state.currentTurnId, event, state };
      })
    );

    expect(result.event).toEqual({
      type: 'subagent_message',
      sessionId: 'child-1',
      agentName: 'build',
      content: 'Message Type: INTER_AGENT_MESSAGE\nfrom root\nhi',
    });
    // 消息不占回合：编号不变
    expect(result.after).toBe(result.before);

    const events = readHistory(
      computePaths(result.state.cwd, result.state.sessionId).transcriptPath
    );
    const last = events[events.length - 1]!;
    expect(last.type).toBe('subagent_message');
    expect('turnId' in last).toBe(false);
  });
});
