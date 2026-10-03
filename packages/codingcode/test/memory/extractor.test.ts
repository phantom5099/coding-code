import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { extractMemory } from '../../src/memory/extractor.js';
import { AgentError } from '../../src/core/error.js';
import type { LLMShape } from '../../src/llm/port.js';
import type { LLMRequest } from '../../src/contracts/provider.js';

const TEST_MODEL = 'demo-model@demo';

/** 记忆提取走非流式通道：断言直接看 complete 的入参。 */
function createMockLlm(response: string) {
  return {
    complete: vi.fn((_req: LLMRequest, _model: string) => Effect.succeed({ content: response })),
    completeStream: vi.fn(),
  };
}

function extract(llm: LLMShape, currentMemory: string, transcript: string) {
  return Effect.runPromise(extractMemory({ currentMemory, transcript, llm, model: TEST_MODEL }));
}

describe('Memory Extractor', () => {
  it('returns memory inside <memory> tags', async () => {
    const response = `<memory>### 主题
- 用户是 TypeScript 开发者</memory>`;

    const result = await extract(createMockLlm(response), '', '[user] I like TypeScript');

    expect(result).toContain('### 主题');
    expect(result).toContain('用户是 TypeScript 开发者');
  });

  it('returns null when memory tags are empty', async () => {
    const result = await extract(createMockLlm('<memory></memory>'), '', '[user] Some text');

    expect(result).toBeNull();
  });

  it('returns null when memory tags not found', async () => {
    const result = await extract(createMockLlm('No memory tags here'), '', '[user] Some text');

    expect(result).toBeNull();
  });

  it('handles LLM call failure gracefully', async () => {
    const llm = {
      complete: vi.fn((_req: LLMRequest, _model: string) =>
        Effect.fail(new AgentError('LLM_FAILED', 'llm unavailable'))
      ),
      completeStream: vi.fn(),
    };

    const result = await extract(llm, '', '');

    expect(result).toBeNull();
  });

  it('passes currentMemory to the model as existing memory', async () => {
    const mockLlm = createMockLlm('<memory></memory>');

    await extract(mockLlm, '### project\n- 旧信息', '[user] 新对话');

    const callArgs = mockLlm.complete.mock.calls[0]?.[0];
    expect(callArgs?.messages[0]?.content).toContain('已有记忆');
    expect(callArgs?.messages[0]?.content).toContain('旧信息');
    expect(callArgs?.messages[0]?.content).toContain('新对话');
  });

  it('keeps instructions in system and transcript data in messages', async () => {
    const mockLlm = createMockLlm('<memory></memory>');

    await extract(mockLlm, '### project\n- Likes TypeScript', '[user] I use Python');

    const callArgs = mockLlm.complete.mock.calls[0]?.[0];
    expect(callArgs?.system).toContain('规则');
    expect(callArgs?.system).toContain('整份');
    expect(callArgs?.system).not.toContain('I use Python');
    expect(callArgs?.messages[0]?.content).toContain('I use Python');
    expect(callArgs?.messages[0]?.content).toContain('Likes TypeScript');
  });

  it('passes the target model to the non-streaming channel', async () => {
    const mockLlm = createMockLlm('<memory></memory>');

    await extract(mockLlm, '', '[user] hi');

    expect(mockLlm.complete.mock.calls[0]?.[1]).toBe(TEST_MODEL);
    expect(mockLlm.completeStream).not.toHaveBeenCalled();
  });
});
