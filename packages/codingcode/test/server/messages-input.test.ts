import { describe, it, expect } from 'vitest';
import { toIncomingParts } from '../../src/server/routes/messages.js';
import type { AgentError } from '../../src/util/error.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as AgentError).code;
  }
  return 'no-throw';
}

describe('toIncomingParts', () => {
  it('文本块原样通过', () => {
    expect(toIncomingParts([{ type: 'text', text: 'hi' }])).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('媒体块解出字节、声明 mime 与文件名', () => {
    const parts = toIncomingParts([
      {
        type: 'media',
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        filename: 'x.png',
      },
    ]);
    expect(parts).toHaveLength(1);
    const media = parts[0] as any;
    expect(media.type).toBe('media');
    expect(Buffer.from(media.bytes).toString('utf8')).toBe('hello');
    expect(media.declaredMimeType).toBe('image/png');
    expect(media.filename).toBe('x.png');
  });

  it('没有文件名也能通过（PDF 之外不强制）', () => {
    const parts = toIncomingParts([
      { type: 'media', dataUrl: 'data:audio/wav;base64,aGVsbG8=' },
    ]);
    expect((parts[0] as any).filename).toBeUndefined();
  });

  it('非数组 input 被拒', () => {
    expect(codeOf(() => toIncomingParts('hi'))).toBe('INVALID_INPUT');
    expect(codeOf(() => toIncomingParts(undefined))).toBe('INVALID_INPUT');
    expect(codeOf(() => toIncomingParts([null]))).toBe('INVALID_INPUT');
  });

  it('shape 不对的部件被拒', () => {
    expect(codeOf(() => toIncomingParts([{ type: 'text' }]))).toBe('INVALID_INPUT');
    expect(codeOf(() => toIncomingParts([{ type: 'media' }]))).toBe('INVALID_INPUT');
    expect(codeOf(() => toIncomingParts([{ type: 'image', dataUrl: 'x' }]))).toBe('INVALID_INPUT');
  });

  it('非 base64 的 dataUrl 被拒', () => {
    // 明文 data URL：没有 ;base64 段
    expect(codeOf(() => toIncomingParts([{ type: 'media', dataUrl: 'data:text/plain,hi' }]))).toBe(
      'INVALID_INPUT'
    );
    // base64 载荷里出现非法字符
    expect(
      codeOf(() => toIncomingParts([{ type: 'media', dataUrl: 'data:image/png;base64,!!!!' }]))
    ).toBe('INVALID_INPUT');
    // 长度模 4 余 1：绝无可能是合法 base64
    expect(
      codeOf(() => toIncomingParts([{ type: 'media', dataUrl: 'data:image/png;base64,aGVsbG8=' }]))
    ).not.toBe('INVALID_INPUT');
    expect(
      codeOf(() => toIncomingParts([{ type: 'media', dataUrl: 'data:image/png;base64,aGVsb' }]))
    ).toBe('INVALID_INPUT');
  });
});
