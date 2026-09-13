import { describe, it, expect, vi } from 'vitest';
import {
  makeState,
  runAgentTurn,
  llmStream,
  pText,
  pEnd,
  texts,
  endReason,
} from './helpers/agent-harness.js';

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
    completeStream: () => llmStream(pText('Hello'), pText(' '), pText('world'), pEnd()),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return llm;
}

describe('runTurn event stream', () => {
  it('should yield text_delta events from LLM stream', async () => {
    const { events } = await runAgentTurn(
      { llm: makeLlm(), state },
      { sessionId: 'test-session', cwd: '/tmp/test' }
    );

    const chunks = texts(events);
    expect(chunks).toContain('Hello');
    expect(chunks).toContain(' ');
    expect(chunks).toContain('world');
  });

  it('should produce a non-empty event stream for a normal LLM response', async () => {
    const { events } = await runAgentTurn(
      { llm: makeLlm(), state },
      { sessionId: 'test-session', cwd: '/tmp/test' }
    );

    expect(events.length).toBeGreaterThan(0);
    expect(endReason(events)).toBe('done');
  });
});
