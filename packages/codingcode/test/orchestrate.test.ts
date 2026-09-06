import { describe, it, expect, vi } from 'vitest';
import { makeState, runAgentTurn } from './helpers/agent-harness.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    maxSteps: 5,
    maxStopContinuations: 2,
    context: { compactionModel: '' },
    memory: { enabled: false },
    server: { port: 8080 },
  }),
}));

const state = makeState({ sessionId: 'test-session', cwd: '/tmp/test', title: 'test-sess' });

function makeLlm() {
  const llm = {
    completeStream: () => ({
      stream: (async function* () {
        yield 'Hello';
        yield ' ';
        yield 'world';
      })(),
      response: Promise.resolve({
        ok: true,
        value: { content: 'Hello world', toolCalls: [] },
      }),
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return llm;
}

describe('runTurn event stream', () => {
  it('should yield LlmChunk events from LLM stream', async () => {
    const { events } = await runAgentTurn(
      { llm: makeLlm(), state },
      { sessionId: 'test-session', cwd: '/tmp/test' }
    );

    const textChunks = events.filter((e: any) => e._tag === 'LlmChunk').map((e: any) => e.text);
    expect(textChunks).toContain('Hello');
    expect(textChunks).toContain(' ');
    expect(textChunks).toContain('world');
  });

  it('should produce a non-empty event stream for a normal LLM response', async () => {
    const { events } = await runAgentTurn(
      { llm: makeLlm(), state },
      { sessionId: 'test-session', cwd: '/tmp/test' }
    );

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
  });
});
