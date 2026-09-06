import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { extractMemory } from '../../src/memory/extractor.js';

describe('Memory Extractor', () => {
  const createMockLlm = (response: string) => ({
    complete: vi.fn(() => Effect.succeed({ content: response, finishReason: 'stop' as const })),
    completeStream: vi.fn(() => ({
      stream: (async function* () {
        yield response;
      })(),
      response: Promise.resolve({
        ok: true as const,
        value: { content: response, finishReason: 'stop' as const },
      }),
    })),
    modelInfo: {
      provider: 'mock',
      model: 'mock',
      maxTokens: 4096,
      supportsToolCalling: true,
      supportsStreaming: true,
    },
  });

  it('returns memory inside <memory> tags', async () => {
    const response = `<memory>### 主题
- 用户是 TypeScript 开发者</memory>`;

    const result = await extractMemory({
      currentMemory: '',
      transcript: '[user] I like TypeScript',
      llm: createMockLlm(response),
    });

    expect(result).toContain('### 主题');
    expect(result).toContain('用户是 TypeScript 开发者');
  });

  it('returns null when memory tags are empty', async () => {
    const result = await extractMemory({
      currentMemory: '',
      transcript: '[user] Some text',
      llm: createMockLlm('<memory></memory>'),
    });

    expect(result).toBeNull();
  });

  it('returns null when memory tags not found', async () => {
    const result = await extractMemory({
      currentMemory: '',
      transcript: '[user] Some text',
      llm: createMockLlm('No memory tags here'),
    });

    expect(result).toBeNull();
  });

  it('handles LLM call failure gracefully', async () => {
    const llm = {
      complete: vi.fn(() => Effect.fail({ code: 'LLM_ERROR', message: 'Stream error' } as any)),
      completeStream: vi.fn(() => ({
        stream: (async function* () {
          throw new Error('Stream error');
        })(),
        response: Promise.resolve({
          ok: false,
          value: { content: '' },
        } as any),
      })),
      modelInfo: {
        provider: 'mock',
        model: 'mock',
        maxTokens: 4096,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
    };

    const result = await extractMemory({
      currentMemory: '',
      transcript: '',
      llm,
    });

    expect(result).toBeNull();
  });

  it('passes currentMemory to the model as existing memory', async () => {
    const mockLlm = createMockLlm('<memory></memory>');

    await extractMemory({
      currentMemory: '### project\n- 旧信息',
      transcript: '[user] 新对话',
      llm: mockLlm,
    });

    const callArgs = (mockLlm.completeStream.mock.calls as any)[0][0] as any;
    expect(callArgs.messages[0].content).toContain('已有记忆');
    expect(callArgs.messages[0].content).toContain('旧信息');
    expect(callArgs.messages[0].content).toContain('新对话');
  });

  it('keeps instructions in system and transcript data in messages', async () => {
    const mockLlm = createMockLlm('<memory></memory>');

    await extractMemory({
      currentMemory: '### project\n- Likes TypeScript',
      transcript: '[user] I use Python',
      llm: mockLlm,
    });

    const callArgs = (mockLlm.completeStream.mock.calls as any)[0][0] as any;
    expect(callArgs.system).toContain('规则');
    expect(callArgs.system).toContain('整份');
    expect(callArgs.system).not.toContain('I use Python');
    expect(callArgs.messages[0].content).toContain('I use Python');
    expect(callArgs.messages[0].content).toContain('Likes TypeScript');
  });
});
