import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMStreamPart } from '../../src/contracts/provider.js';

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

const USAGE = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
const EXPECTED_USAGE = { prompt: 100, completion: 50, total: 150 };

async function collect(stream: AsyncIterable<LLMStreamPart>): Promise<LLMStreamPart[]> {
  const parts: LLMStreamPart[] = [];
  for await (const part of stream) {
    parts.push(part);
  }
  return parts;
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
    tools: withTools
      ? [{ name: 'read_file', description: 'Read file', parameters: { type: 'object' } }]
      : undefined,
    maxSteps: 1,
  };
}

describe('OpenAIProvider completeStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateText.mockResolvedValue({ text: 'done', toolCalls: [], usage: USAGE });
    streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'streamed' };
        yield { type: 'finish', totalUsage: USAGE };
      })(),
    });
  });

  it('uses non-streaming completion for sansen requests with tools', async () => {
    const { OpenAIProvider } = await import('../../src/llm/providers/openai.js');
    const provider = new OpenAIProvider({} as any, entry('sansen'));

    const parts = await collect(provider.completeStream(request(true) as any));

    expect(parts).toEqual([
      { type: 'text', text: 'done' },
      { type: 'end', usage: EXPECTED_USAGE },
    ]);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(streamText).not.toHaveBeenCalled();
  }, 30000);

  it('keeps streaming for sansen requests without tools', async () => {
    const { OpenAIProvider } = await import('../../src/llm/providers/openai.js');
    const provider = new OpenAIProvider({} as any, entry('sansen'));

    const parts = await collect(provider.completeStream(request(false) as any));

    expect(parts).toEqual([
      { type: 'text', text: 'streamed' },
      { type: 'end', usage: EXPECTED_USAGE },
    ]);
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('keeps streaming for non-sansen requests with tools', async () => {
    const { OpenAIProvider } = await import('../../src/llm/providers/openai.js');
    const provider = new OpenAIProvider({} as any, entry('openai'));

    const parts = await collect(provider.completeStream(request(true) as any));

    expect(parts).toEqual([
      { type: 'text', text: 'streamed' },
      { type: 'end', usage: EXPECTED_USAGE },
    ]);
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('maps tool-call parts to tool_call stream parts', async () => {
    streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'reading' };
        yield { type: 'tool-call', toolCallId: 'tc-1', toolName: 'read_file', input: { path: 'a.ts' } };
        yield { type: 'finish', totalUsage: USAGE };
      })(),
    });
    const { OpenAIProvider } = await import('../../src/llm/providers/openai.js');
    const provider = new OpenAIProvider({} as any, entry('openai'));

    const parts = await collect(provider.completeStream(request(false) as any));

    expect(parts).toEqual([
      { type: 'text', text: 'reading' },
      { type: 'tool_call', id: 'tc-1', name: 'read_file', args: { path: 'a.ts' } },
      { type: 'end', usage: EXPECTED_USAGE },
    ]);
  });

  it('extracts usage from the finish part', async () => {
    const { OpenAIProvider } = await import('../../src/llm/providers/openai.js');
    const provider = new OpenAIProvider({} as any, entry('openai'));

    const parts = await collect(provider.completeStream(request(false) as any));
    const end = parts.find((p) => p.type === 'end');

    expect(end).toEqual({ type: 'end', usage: EXPECTED_USAGE });
  }, 30000);
});
