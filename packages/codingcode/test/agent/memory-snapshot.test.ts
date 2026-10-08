import { describe, it, expect, vi } from 'vitest';
import { makeState, runAgentTurn, llmStream, pEnd } from '../helpers/agent-harness.js';

vi.mock('../../src/infra/config.js', () => ({
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
  }),
}));

const MEMORY = '## Long-term Memory\n\nFrozen content';

function makeStateForMemory() {
  return makeState({ sessionId: 'memory-test-sid', cwd: '/tmp/memory-test', title: 'memory-test' });
}

function makeCapturingLlm() {
  const captured: { system?: string } = {};
  const llm = {
    completeStream: vi.fn((params: any) => {
      captured.system = params.system;
      return llmStream(pEnd());
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return { llm, captured };
}

async function runOnce(llm: any, memorySnapshot: string = '') {
  return runAgentTurn(
    { llm, state: makeStateForMemory(), memorySnapshot },
    { sessionId: 'memory-test-sid', cwd: '/tmp/memory-test' }
  );
}

describe('Memory snapshot semantics', () => {
  it('injects the provided memory snapshot into the system prompt', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, MEMORY);
    expect(captured.system).toContain('Frozen content');
  });
});
