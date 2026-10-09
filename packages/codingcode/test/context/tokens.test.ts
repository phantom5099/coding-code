import { describe, it, expect } from 'vitest';
import { estimateTokensForContent } from '../../src/context/tokens.js';

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
