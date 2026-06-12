import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { extractMemory } from '../../src/memory/extractor.js';
import type { StructuredTranscript } from '../../src/memory/extractor.js';
import type { MemoryTypeConfig } from '@codingcode/infra/config';

describe('Memory Extractor', () => {
  const createMockLlm = (response: string) => ({
    complete: vi.fn(() =>
      Effect.succeed({ content: response, finishReason: 'stop' as const })
    ),
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

  const defaultTypes: MemoryTypeConfig[] = [
    { name: 'user', description: 'User info', enabled: true },
    { name: 'project', description: 'Project info', enabled: true },
    { name: 'reference', description: 'References', enabled: true },
  ];

  it('extracts memory from transcript', async () => {
    const response = `<memory>### user
- User is a TypeScript developer</memory>`;

    const transcript: StructuredTranscript = {
      userOnly: 'I like TypeScript',
      userAndAssistant: 'I like TypeScript\n---\nTypeScript is great',
      userAndTools: 'I like TypeScript',
    };

    const result = await extractMemory({
      currentAuto: '',
      transcript,
      types: defaultTypes,
      llm: createMockLlm(response),
    });

    expect(result).toContain('### user');
    expect(result).toContain('User is a TypeScript developer');
  });

  it('returns null when memory tags are empty', async () => {
    const response = '<memory></memory>';

    const transcript: StructuredTranscript = {
      userOnly: 'Some text',
      userAndAssistant: 'Some text',
      userAndTools: 'Some text',
    };

    const result = await extractMemory({
      currentAuto: '',
      transcript,
      types: defaultTypes,
      llm: createMockLlm(response),
    });

    expect(result).toBeNull();
  });

  it('returns null when memory tags not found', async () => {
    const response = 'No memory tags here';

    const transcript: StructuredTranscript = {
      userOnly: 'Some text',
      userAndAssistant: 'Some text',
      userAndTools: 'Some text',
    };

    const result = await extractMemory({
      currentAuto: '',
      transcript,
      types: defaultTypes,
      llm: createMockLlm(response),
    });

    expect(result).toBeNull();
  });

  it('handles LLM call failure gracefully', async () => {
    const llm = {
      complete: vi.fn(() =>
        Effect.fail({ code: 'LLM_ERROR', message: 'Stream error' } as any)
      ),
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

    const transcript: StructuredTranscript = {
      userOnly: '',
      userAndAssistant: '',
      userAndTools: '',
    };

    const result = await extractMemory({
      currentAuto: '',
      transcript,
      types: defaultTypes,
      llm,
    });

    expect(result).toBeNull();
  });

  it('includes currentAuto in system prompt', async () => {
    const mockLlm = createMockLlm('<memory></memory>');
    const response = '<memory></memory>';

    const transcript: StructuredTranscript = {
      userOnly: 'text',
      userAndAssistant: 'text',
      userAndTools: 'text',
    };

    const currentAuto = '### user\n- Old info';

    await extractMemory({
      currentAuto,
      transcript,
      types: defaultTypes,
      llm: mockLlm,
    });

    const callArgs = (mockLlm.completeStream.mock.calls as any)[0][0] as any;
    expect(callArgs.messages[0].content).toContain('已有记忆');
    expect(callArgs.messages[0].content).toContain('Old info');
  });

  it('includes transcript in system prompt with labels', async () => {
    const mockLlm = createMockLlm('<memory></memory>');

    const transcript: StructuredTranscript = {
      userOnly: 'user text',
      userAndAssistant: 'user text\nassistant response',
      userAndTools: 'user text\ntool output',
    };

    await extractMemory({
      currentAuto: '',
      transcript,
      types: defaultTypes,
      llm: mockLlm,
    });

    const callArgs = (mockLlm.completeStream.mock.calls as any)[0][0] as any;
    expect(callArgs.messages[0].content).toContain('[user]');
    expect(callArgs.messages[0].content).toContain('[user+assistant]');
    expect(callArgs.messages[0].content).toContain('[user+tool]');
  });

  it('only calls system prompt with specified types', async () => {
    const mockLlm = createMockLlm('<memory></memory>');
    const twoTypes: MemoryTypeConfig[] = [defaultTypes[0]!, defaultTypes[1]!];

    const transcript: StructuredTranscript = {
      userOnly: 'text',
      userAndAssistant: 'text',
      userAndTools: 'text',
    };

    await extractMemory({
      currentAuto: '',
      transcript,
      types: twoTypes,
      llm: mockLlm,
    });

    const callArgs = (mockLlm.completeStream.mock.calls as any)[0][0] as any;
    // Should not mention reference guidance
    expect(callArgs.system).not.toContain('reference');
  });

  it('passes non-empty messages array with role user', async () => {
    const mockLlm = createMockLlm('<memory></memory>');

    const transcript: StructuredTranscript = {
      userOnly: 'text',
      userAndAssistant: 'text',
      userAndTools: 'text',
    };

    await extractMemory({
      currentAuto: '',
      transcript,
      types: defaultTypes,
      llm: mockLlm,
    });

    const callArgs = (mockLlm.completeStream.mock.calls as any)[0][0] as any;
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].role).toBe('user');
    expect(callArgs.messages[0].content).toBeTruthy();
  });

  it('separates instruction in system and data in messages', async () => {
    const mockLlm = createMockLlm('<memory></memory>');

    const transcript: StructuredTranscript = {
      userOnly: 'I use Python',
      userAndAssistant: 'I use Python',
      userAndTools: 'I use Python',
    };

    await extractMemory({
      currentAuto: '### user\n- Likes TypeScript',
      transcript,
      types: defaultTypes,
      llm: mockLlm,
    });

    const callArgs = (mockLlm.completeStream.mock.calls as any)[0][0] as any;
    // system contains instructions, not transcript data
    expect(callArgs.system).toContain('规则');
    expect(callArgs.system).toContain('记忆类型');
    expect(callArgs.system).not.toContain('I use Python');
    // messages contains transcript data, not instructions
    expect(callArgs.messages[0].content).toContain('I use Python');
    expect(callArgs.messages[0].content).toContain('Likes TypeScript');
  });
});
