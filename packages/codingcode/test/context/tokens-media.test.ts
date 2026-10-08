import { describe, it, expect } from 'vitest';
import {
  estimateMessageTokens,
  estimateTokensForPart,
} from '../../src/context/tokens.js';
import type { StoredMediaPart } from '../../src/session/types.js';

function image(extra: Partial<StoredMediaPart> = {}): StoredMediaPart {
  return { type: 'media', asset: 'a.png', mimeType: 'image/png', bytes: 1024, ...extra };
}

describe('estimateTokensForPart', () => {
  it('图片按 tile 折算，显著高于同长度纯文本', () => {
    const textTokens = estimateTokensForPart({ type: 'text', text: 'a'.repeat(20) });
    const imageTokens = estimateTokensForPart(image({ width: 512, height: 512 }));
    expect(textTokens).toBeLessThan(20);
    expect(imageTokens).toBe(85 + 170);
    expect(imageTokens).toBeGreaterThan(textTokens * 10);
  });

  it('图片按 tile 数递增，缺宽高时按 1 个 tile 兜底', () => {
    expect(estimateTokensForPart(image({ width: 512, height: 512 }))).toBe(255);
    expect(estimateTokensForPart(image({ width: 1024, height: 1024 }))).toBe(85 + 170 * 4);
    expect(estimateTokensForPart(image())).toBe(255);
  });

  it('音频随 durationSec 线性变化', () => {
    const one = estimateTokensForPart({
      type: 'media',
      asset: 'a.wav',
      mimeType: 'audio/wav',
      bytes: 8000,
      durationSec: 1,
    });
    const ten = estimateTokensForPart({
      type: 'media',
      asset: 'a.wav',
      mimeType: 'audio/wav',
      bytes: 80000,
      durationSec: 10,
    });
    expect(one).toBe(32);
    expect(ten).toBe(320);
    expect(ten).toBe(one * 10);
  });

  it('file 档（PDF）随字节数线性变化', () => {
    const oneMb = estimateTokensForPart({
      type: 'media',
      asset: 'a.pdf',
      mimeType: 'application/pdf',
      bytes: 1024 * 1024,
    });
    const twoMb = estimateTokensForPart({
      type: 'media',
      asset: 'a.pdf',
      mimeType: 'application/pdf',
      bytes: 2 * 1024 * 1024,
    });
    expect(oneMb).toBe(50_000);
    expect(twoMb).toBe(100_000);
    expect(twoMb).toBe(oneMb * 2);
  });
});

describe('estimateMessageTokens', () => {
  it('把每个 part 的估算与消息固定开销相加', () => {
    const withImage = estimateMessageTokens({
      role: 'user',
      content: [image({ width: 512, height: 512 })],
    });
    const empty = estimateMessageTokens({ role: 'user', content: [] });
    expect(withImage).toBe(empty + 255);
  });
});
