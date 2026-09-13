import { describe, it, expect, vi } from 'vitest';
import { makeState, runAgentTurn, llmStream, pEnd } from '../helpers/agent-harness.js';

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

const MEMORY = '## Long-term Memory\n\nFrozen content';

function makeStateForMemory() {
  return makeState({ sessionId: 'memory-test-sid', cwd: '/tmp/memory-test', title: 'memory-test' });
}

function makeCapturingLlm() {
  const captured: { system?: string; messages?: any[] } = {};
  const llm = {
    completeStream: vi.fn((params: any) => {
      captured.system = params.system;
      captured.messages = params.messages;
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
  it('loads memory via MemoryPort and includes it in the system prompt', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, MEMORY);
    expect(captured.system).toContain('## Session Memory');
    expect(captured.system).toContain('Frozen content');
  });

  it('system prompt is byte-identical across consecutive turns with the same memory snapshot', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, MEMORY);
    const first = captured.system;
    expect(first).toBeDefined();
    await runOnce(llm, MEMORY);
    const second = captured.system;
    expect(second).toBe(first);
  });

  it('appends memory verbatim and does not inject <system-reminder> into messages', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, MEMORY);
    // memory 块原样拼在 "## Session Memory" 标题之后，中间无注入的 reminder 包装
    expect(captured.system).toContain('## Session Memory\n\n## Long-term Memory\n\nFrozen content');
    const allContents = (captured.messages ?? [])
      .map((m: any) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    expect(allContents).not.toContain('<system-reminder>');
  });
});
