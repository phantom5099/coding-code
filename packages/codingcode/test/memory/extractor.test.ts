import { describe, it, expect, vi } from 'vitest';
import { extractMemory } from '../../src/memory/extractor.js';
import type { StructuredTranscript } from '../../src/memory/extractor.js';
import type { MemoryTypeConfig } from '@codingcode/infra';
import type { LLMStreamAdapter } from '../../src/agent/agent.js';

describe('Memory Extractor', () => {
  const createMockLlm = (response: string): LLMStreamAdapter => ({
    completeStream: vi.fn(() => ({
      stream: (async function* () {
        yield response;
      })(),
      response: Promise.resolve({
        ok: true,
        value: { content: response },
      }),
    })),
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
    const llm: LLMStreamAdapter = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {
          throw new Error('Stream error');
        })(),
        response: Promise.resolve({
          ok: false,
          value: { content: '' },
        } as any),
      })),
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

    const callArgs = mockLlm.completeStream.mock.calls[0][0];
    expect(callArgs.system).toContain('<existing_memory>');
    expect(callArgs.system).toContain('Old info');
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

    const callArgs = mockLlm.completeStream.mock.calls[0][0];
    expect(callArgs.system).toContain('[user]');
    expect(callArgs.system).toContain('[user+assistant]');
    expect(callArgs.system).toContain('[user+tool]');
  });

  it('only calls system prompt with specified types', async () => {
    const mockLlm = createMockLlm('<memory></memory>');
    const twoTypes = [defaultTypes[0], defaultTypes[1]];

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

    const callArgs = mockLlm.completeStream.mock.calls[0][0];
    // Should not mention reference guidance
    expect(callArgs.system).not.toContain('reference');
  });
});
