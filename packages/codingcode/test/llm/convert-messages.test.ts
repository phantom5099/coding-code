import { describe, it, expect } from 'vitest';
import { convertMessages } from '../../src/llm/providers/shared.js';
import type { ResolvedContentPart, ResolvedMessage } from '../../src/llm/types.js';

const t = (text: string): ResolvedContentPart => ({ type: 'text', text });

function userWith(content: ResolvedContentPart[]): ResolvedMessage[] {
  return [{ role: 'user', content }];
}

describe('convertMessages', () => {
  it('纯文本 user 消息产出一个 text part', () => {
    expect(convertMessages(userWith([t('hello')]))).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('图片 / 音频 / PDF 都产出 file part，不按种类分派', () => {
    const out = convertMessages(
      userWith([
        t('看看这些'),
        { type: 'media', dataUrl: 'data:image/png;base64,AAA', mimeType: 'image/png' },
        { type: 'media', dataUrl: 'data:audio/wav;base64,BBB', mimeType: 'audio/wav' },
        {
          type: 'media',
          dataUrl: 'data:application/pdf;base64,CCC',
          mimeType: 'application/pdf',
          filename: 'doc.pdf',
        },
      ])
    );

    expect(out[0]!.content).toEqual([
      { type: 'text', text: '看看这些' },
      {
        type: 'file',
        data: 'data:image/png;base64,AAA',
        mediaType: 'image/png',
        filename: undefined,
      },
      {
        type: 'file',
        data: 'data:audio/wav;base64,BBB',
        mediaType: 'audio/wav',
        filename: undefined,
      },
      {
        type: 'file',
        data: 'data:application/pdf;base64,CCC',
        mediaType: 'application/pdf',
        filename: 'doc.pdf',
      },
    ]);
  });

  it('请求体里不出现 detail 字段（不把 OpenAI 的图片档位带进协议层）', () => {
    const out = convertMessages(
      userWith([{ type: 'media', dataUrl: 'data:image/png;base64,AAA', mimeType: 'image/png' }])
    );
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('detail');
  });

  it('assistant 带 tool_calls 时产出 text + tool-call part', () => {
    const out = convertMessages([
      {
        role: 'assistant',
        content: [t('thinking')],
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
      { role: 'tool', content: [t('output')], tool_call_id: 'tc1', tool_name: 'read_file' },
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
    expect(convertMessages([{ role: 'system', content: [t('rules')] }])).toEqual([
      { role: 'system', content: [{ type: 'text', text: 'rules' }] },
    ]);
  });
});
