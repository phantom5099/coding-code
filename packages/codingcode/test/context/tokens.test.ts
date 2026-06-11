import { describe, it, expect } from 'vitest';
import {
  estimateTokensForContent,
  estimateTokens,
  estimateMessageTokens,
} from '../../src/context/util.js';

describe('token estimation', () => {
  it('empty content returns 0', () => {
    expect(estimateTokensForContent('')).toBe(0);
  });

  it('ASCII text estimates ~1 token per 3.5 chars', () => {
    expect(estimateTokensForContent('hello world')).toBe(4);
    expect(estimateTokensForContent('a'.repeat(35))).toBe(10);
  });

  it('CJK text estimates ~1 token per char', () => {
    expect(estimateTokensForContent('你好世界')).toBe(4);
    expect(estimateTokensForContent('这是一个测试字符串')).toBe(9);
    expect(estimateTokensForContent('这是一个测试字符串吗')).toBe(10);
  });

  it('mixed CJK and ASCII sums separately', () => {
    expect(estimateTokensForContent('hello世界')).toBe(4);
  });
});

describe('estimateMessageTokens', () => {
  it('counts content + role + fixed structure overhead', () => {
    const msg = { role: 'user', content: 'hello' } as any;
    // content: ceil(5/3.5)=2, role: ceil(4/3.5)=2, structure: 4 => 8
    expect(estimateMessageTokens(msg)).toBe(8);
  });

  it('includes tool_call_id and tool_name for tool messages', () => {
    const msg = {
      role: 'tool',
      content: 'result',
      tool_call_id: 'tc123',
      tool_name: 'bash',
    } as any;
    // content: ceil(6/3.5)=2, role: ceil(4/3.5)=2, tool_call_id: ceil(5/3.5)=2,
    // tool_name: ceil(4/3.5)=2, structure: 4 => 12
    expect(estimateMessageTokens(msg)).toBe(12);
  });

  it('includes name for system/assistant messages', () => {
    const msg = { role: 'system', name: 'compacted_history', content: 'summary' } as any;
    // content: ceil(7/3.5)=2, role: ceil(6/3.5)=2, name: ceil(17/3.5)=5, structure: 4 => 13
    expect(estimateMessageTokens(msg)).toBe(13);
  });
});

describe('estimateTokens', () => {
  it('aggregates full message tokens across array', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '你好' },
    ] as any;
    // user: content(2) + role(2) + structure(4) = 8
    // assistant: content(2) + role(3) + structure(4) = 9
    expect(estimateTokens(messages)).toBe(17);
  });
});
