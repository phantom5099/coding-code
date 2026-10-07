import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMStreamPart } from '../../src/llm/types.js';

const streamText = vi.fn();
const stepCountIs = vi.fn((count: number) => ({ count }));
const jsonSchema = vi.fn((schema: unknown) => schema);

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText,
  stepCountIs,
  jsonSchema,
}));

const USAGE = { inputTokens: 200, outputTokens: 100, totalTokens: 300 };

async function collect(stream: AsyncIterable<LLMStreamPart>): Promise<LLMStreamPart[]> {
  const parts: LLMStreamPart[] = [];
  for await (const part of stream) {
    parts.push(part);
  }
  return parts;
}

function entry() {
  return {
    id: 'model@deepseek',
    provider: 'deepseek',
    driver: 'openai',
    name: 'DeepSeek',
    model: 'deepseek-chat',
    base_url: 'https://api.deepseek.com/v1',
    api_key_env: 'DEEPSEEK_API_KEY',
    context_window: 64000,
  };
}

function request() {
  return {
    system: 'system',
    messages: [{ role: 'user', content: 'hello' }],
    tools: undefined,
    maxSteps: 1,
  };
}

describe('DeepSeekProvider completeStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'streamed' };
        yield { type: 'finish', totalUsage: USAGE };
      })(),
    });
  });

  it('streams text and extracts usage from the finish part', async () => {
    const { DeepSeekProvider } = await import('../../src/llm/providers/deepseek.js');
    const provider = new DeepSeekProvider({} as any, entry());

    const parts = await collect(provider.completeStream(request() as any));

    expect(parts).toEqual([
      { type: 'text', text: 'streamed' },
      { type: 'end', usage: { prompt: 200, completion: 100, total: 300 } },
    ]);
    expect(streamText).toHaveBeenCalledTimes(1);
  }, 30000);
});
