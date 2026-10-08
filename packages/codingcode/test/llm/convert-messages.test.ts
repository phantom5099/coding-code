import { describe, it, expect } from 'vitest';
import { convertMessages } from '../../src/llm/providers/shared.js';
import type { Message } from '../../src/llm/types.js';
import { text } from '../helpers/parts.js';

function userWith(content: Message['content']): Message[] {
  return [{ role: 'user', content }];
}

describe('convertMessages', () => {
  it('纯文本 user 消息产出一个 text part', () => {
    expect(convertMessages(userWith(text('hello')))).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('图片 / 音频 / PDF 都产出 file part，不按种类分派', () => {
    const resolveAsset = (asset: string) => `data:${asset}`;
    const out = convertMessages(
      userWith([
        { type: 'text', text: '看看这些' },
        { type: 'media', asset: 'img.png', mimeType: 'image/png' },
        { type: 'media', asset: 'sound.wav', mimeType: 'audio/wav' },
        {
          type: 'media',
          asset: 'doc.pdf',
          mimeType: 'application/pdf',
          filename: 'doc.pdf',
        },
      ]),
      resolveAsset
    );

    expect(out[0]!.content).toEqual([
      { type: 'text', text: '看看这些' },
      { type: 'file', data: 'data:img.png', mediaType: 'image/png', filename: undefined },
      { type: 'file', data: 'data:sound.wav', mediaType: 'audio/wav', filename: undefined },
      {
        type: 'file',
        data: 'data:doc.pdf',
        mediaType: 'application/pdf',
        filename: 'doc.pdf',
      },
    ]);
  });

  it('请求体里不出现 detail 字段（不把 OpenAI 的图片档位带进协议层）', () => {
    const out = convertMessages(
      userWith([{ type: 'media', asset: 'img.png', mimeType: 'image/png' }]),
      () => 'data:img.png'
    );
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('detail');
  });

  it('资产缺失时降级成文本标记，不抛错', () => {
    const out = convertMessages(
      userWith([
        { type: 'text', text: 'before' },
        { type: 'media', asset: 'gone.png', mimeType: 'image/png' },
        { type: 'text', text: 'after' },
      ]),
      () => undefined
    );
    expect(out[0]!.content).toEqual([
      { type: 'text', text: 'before' },
      { type: 'text', text: '[media missing: gone.png]' },
      { type: 'text', text: 'after' },
    ]);
  });

  it('完全没给 resolver 时也降级成文本标记', () => {
    const out = convertMessages(
      userWith([{ type: 'media', asset: 'gone.png', mimeType: 'image/png' }])
    );
    expect(out[0]!.content).toEqual([{ type: 'text', text: '[media missing: gone.png]' }]);
  });

  it('assistant 带 tool_calls 时产出 text + tool-call part', () => {
    const out = convertMessages([
      {
        role: 'assistant',
        content: text('thinking'),
        tool_calls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }],
      },
    ]);
    expect(out[0]!.content).toEqual([
      { type: 'text', text: 'thinking' },
      { type: 'tool-call', toolCallId: 'tc1', toolName: 'read_file', input: { path: 'a.ts' } },
    ]);
  });

  it('tool 消息产出 tool-result part，输出取自文本投影', () => {
    const out = convertMessages([
      { role: 'tool', content: text('output'), tool_call_id: 'tc1', tool_name: 'read_file' },
    ]);
    expect(out[0]!.content).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'tc1',
        toolName: 'read_file',
        output: { type: 'text', value: 'output' },
      },
    ]);
  });

  it('system 消息按 parts 映射', () => {
    expect(convertMessages([{ role: 'system', content: text('rules') }])).toEqual([
      { role: 'system', content: [{ type: 'text', text: 'rules' }] },
    ]);
  });
});
