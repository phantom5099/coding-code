import { describe, it, expect, vi } from 'vitest';
import { makeState, runAgentTurn, textDeltas } from '../helpers/agent-harness.js';
import type { FrameBody, Transition } from '../../src/contracts/frame.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    maxSteps: 5,
    maxStopContinuations: 2,
    context: { compactionModel: '' },
    memory: { enabled: false },
    server: { port: 8080 },
  }),
}));

const state = makeState({ sessionId: 'abort-sid', cwd: '/tmp', title: 'abort' });

type EndTransition = Extract<Transition, { to: 'end' }>;

function endsOf(events: readonly FrameBody[]): EndTransition[] {
  const out: EndTransition[] = [];
  for (const b of events) {
    if (b.family === 'transition' && b.transition.to === 'end') out.push(b.transition);
  }
  return out;
}

// 长流：abort 前尽量多产内容，制造 producer 仍在跑时被中断的竞态
function makeLongLlm() {
  return {
    completeStream: () =>
      (async function* () {
        for (let i = 0; i < 500; i++) yield { type: 'text' as const, text: 'x' };
        yield { type: 'end' as const };
      })(),
    modelInfo: { maxTokens: 1000 },
  } as any;
}

describe('abort race (end frame is always produced exactly once)', () => {
  it('terminates with exactly one end frame when aborted mid-stream', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const { events } = await runAgentTurn(
      { llm: makeLongLlm(), state },
      { sessionId: state.sessionId, cwd: '/tmp', signal: controller.signal }
    );

    const ends = endsOf(events);
    expect(ends).toHaveLength(1);
    // 中断路径要么给出 aborted，要么在检查点收尾为 done；绝不会漏帧或补成兜底错误
    expect(['aborted', 'done']).toContain(ends[0]!.reason);
    // 确实在流中途被截断，而不是跑完 500 段
    expect(textDeltas(events).length).toBeLessThan(500);
  }, 20000);

  it('produces exactly one aborted end frame when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const { events } = await runAgentTurn(
      { llm: makeLongLlm(), state },
      { sessionId: state.sessionId, cwd: '/tmp', signal: controller.signal }
    );

    const ends = endsOf(events);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.reason).toBe('aborted');
  }, 20000);
});
