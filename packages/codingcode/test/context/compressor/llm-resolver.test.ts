import { describe, it, expect } from 'vitest';
import { resolveCompactionLLM } from '../../../src/context/compressor/llm-resolver.js';
import type { LLMClient } from '../../../src/llm/client.js';
import type { ContextConfig } from '../../../src/context/config.js';

const fakeFallback: LLMClient = {
  complete: async () => ({ ok: true as const, value: { content: '', finishReason: 'stop' } }),
  completeStream: () => ({
    stream: (async function* () {})(),
    response: Promise.resolve({ ok: true as const, value: { content: '', finishReason: 'stop' } }),
  }),
  modelInfo: {
    provider: 'fake',
    model: 'fake',
    maxTokens: 1,
    supportsToolCalling: false,
    supportsStreaming: false,
  },
};

function cfg(compactionModel: string): ContextConfig {
  return {
    microCompactThreshold: 0.5,
    microCompactMinChars: 120,
    compactionThreshold: 0.9,
    keepRecentTurns: 1,
    compactionModel,
    reactiveCompactMaxRetries: 1,
  };
}

describe('resolveCompactionLLM', () => {
  it('returns fallback when compactionModel is empty', async () => {
    const result = await resolveCompactionLLM(cfg(''), fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when compactionModel is whitespace-only', async () => {
    const result = await resolveCompactionLLM(cfg('   '), fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when target model is not in models.json', async () => {
    const result = await resolveCompactionLLM(cfg('definitely-not-a-real-model-xyz'), fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns null when compactionModel empty and no fallback given', async () => {
    const result = await resolveCompactionLLM(cfg(''), null);
    expect(result).toBeNull();
  });
});
