import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateText = vi.fn();
const streamText = vi.fn();
const stepCountIs = vi.fn((count: number) => ({ count }));
const jsonSchema = vi.fn((schema: unknown) => schema);

vi.mock('ai', () => ({
  generateText,
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

function entry(provider: string) {
  return {
    id: `model@${provider}`,
    provider,
    driver: 'openai',
    name: 'Model',
    model: 'model',
    base_url: 'https://example.com/v1',
    api_key_env: 'API_KEY',
    context_window: 128000,
  };
}

function request(withTools: boolean) {
  return {
    system: 'system',
    messages: [{ role: 'user', content: 'hello' }],
    tools: withTools ? [{ name: 'read_file', description: 'Read file', parameters: { type: 'object' } }] : undefined,
    maxSteps: 1,
  };
}

describe('OpenAIProvider completeStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateText.mockResolvedValue({
      response: {
        messages: [{ role: 'assistant', content: 'done' }],
      },
    });
    streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'streamed' };
      })(),
      response: Promise.resolve({
        messages: [{ role: 'assistant', content: 'streamed' }],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }),
    });
  });

  it('uses non-streaming completion for sansen requests with tools', async () => {
    const { OpenAIProvider } = await import('../../src/llm/providers/openai.js');
    const provider = new OpenAIProvider({} as any, entry('sansen'));

    const result = provider.completeStream(request(true) as any);
    await expect(result.response).resolves.toMatchObject({ ok: true, value: { content: 'done' } });
    await expect(collect(result.stream)).resolves.toEqual(['done']);

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(streamText).not.toHaveBeenCalled();
  });

  it('keeps streaming for sansen requests without tools', async () => {
    const { OpenAIProvider } = await import('../../src/llm/providers/openai.js');
    const provider = new OpenAIProvider({} as any, entry('sansen'));

    const result = provider.completeStream(request(false) as any);
    await expect(collect(result.stream)).resolves.toEqual(['streamed']);

    expect(streamText).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('keeps streaming for non-sansen requests with tools', async () => {
    const { OpenAIProvider } = await import('../../src/llm/providers/openai.js');
    const provider = new OpenAIProvider({} as any, entry('openai'));

    const result = provider.completeStream(request(true) as any);
    await expect(collect(result.stream)).resolves.toEqual(['streamed']);

    expect(streamText).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('extracts usage from streamText response', async () => {
    const { OpenAIProvider } = await import('../../src/llm/providers/openai.js');
    const provider = new OpenAIProvider({} as any, entry('openai'));

    const result = provider.completeStream(request(false) as any);
    const resp = await result.response;
    expect(resp.ok).toBe(true);
    if (resp.ok) {
      expect(resp.value.usage).toEqual({ prompt: 100, completion: 50, total: 150 });
    }
  });
});
