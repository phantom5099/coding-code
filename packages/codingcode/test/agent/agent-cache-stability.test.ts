import { describe, it, expect, vi } from 'vitest';
import { makeState, runAgentTurn } from '../helpers/agent-harness.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    maxSteps: 5,
    maxStopContinuations: 2,
    context: {
      compactionModel: '',
    },
    memory: {
      enabled: false,
      model: '',
      maxBytes: 16384,
      promptMaxBytes: 8192,
    },
    server: { port: 8080 },
  }),
}));

const mockState = makeState({
  sessionId: 'cache-test-sid',
  cwd: '/tmp/cache-test',
  title: 'cache-stability',
});

function makeCapturingLlm() {
  const captured: { system?: string } = {};
  const llm = {
    completeStream: vi.fn((params: any) => {
      captured.system = params.system;
      return {
        stream: (async function* () {})(),
        response: Promise.resolve({ ok: true, value: { content: '' } }),
      };
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return { llm, captured };
}

async function runOnce(llm: any) {
  return runAgentTurn(
    { llm, state: mockState },
    { sessionId: 'cache-test-sid', cwd: '/tmp/cache-test' }
  );
}

describe('LLM prompt cache stability', () => {
  it('system prompt does not include deferred tools catalog', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm);
    expect(captured.system).toBeDefined();
    expect(captured.system).not.toContain('<available-deferred-tools>');
    expect(captured.system).not.toContain('</available-deferred-tools>');
  });

  it('system prompt is byte-identical across consecutive turns', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm);
    const first = captured.system;
    expect(first).toBeDefined();
    await runOnce(llm);
    const second = captured.system;
    expect(second).toBe(first);
  });
});
