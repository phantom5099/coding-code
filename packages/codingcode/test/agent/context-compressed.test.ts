import { describe, it, expect } from 'vitest';
import { makeState, runAgentTurn, llmStream, pText, pEnd, hasCompress } from '../helpers/agent-harness.js';

function makePlainLlm(content = 'ok') {
  return {
    completeStream: () => llmStream(pText(content), pEnd()),
    modelInfo: { provider: 'mock', model: 'mock', maxTokens: 1000 },
  } as any;
}

function phaseOrder(events: readonly unknown[]): string[] {
  return (events as any[]).flatMap((b) => (b.family === 'transition' ? [b.transition.to] : []));
}

describe('compaction transition', () => {
  it('emits the compress signal when willCompact is true', async () => {
    const { events } = await runAgentTurn(
      {
        llm: makePlainLlm(),
        state: makeState(),
        contextWillCompact: async () => true,
      },
      { sessionId: 'sid', cwd: '/tmp' }
    );

    expect(hasCompress(events)).toBe(true);
  });

  it('returns to executing right after compress (compress is an enter/return pair)', async () => {
    const { events } = await runAgentTurn(
      {
        llm: makePlainLlm(),
        state: makeState(),
        contextWillCompact: async () => true,
      },
      { sessionId: 'sid', cwd: '/tmp' }
    );

    const tos = phaseOrder(events);
    expect(tos[tos.indexOf('compress') + 1]).toBe('executing');
  });

  it('emits no compress signal when willCompact is false', async () => {
    const { events } = await runAgentTurn(
      {
        llm: makePlainLlm(),
        state: makeState(),
      },
      { sessionId: 'sid', cwd: '/tmp' }
    );

    expect(hasCompress(events)).toBe(false);
  });
});
