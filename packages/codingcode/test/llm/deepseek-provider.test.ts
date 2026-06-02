import { describe, it, expect, vi, beforeEach } from 'vitest';

const streamText = vi.fn();
const stepCountIs = vi.fn((count: number) => ({ count }));
const jsonSchema = vi.fn((schema: unknown) => schema);

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText,
  stepCountIs,
  jsonSchema,
}));

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
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
      })(),
      response: Promise.resolve({
        messages: [{ role: 'assistant', content: 'streamed' }],
        usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      }),
    });
  });

  it('streams text and extracts usage from response', async () => {
    const { DeepSeekProvider } = await import('../../src/llm/providers/deepseek.js');
    const provider = new DeepSeekProvider({} as any, entry());

    const result = provider.completeStream(request() as any);
    await expect(collect(result.stream)).resolves.toEqual(['streamed']);

    const resp = await result.response;
    expect(resp.ok).toBe(true);
    if (resp.ok) {
      expect(resp.value.usage).toEqual({ prompt: 200, completion: 100, total: 300 });
    }

    expect(streamText).toHaveBeenCalledTimes(1);
  });
});
