import { describe, it, expect } from 'vitest';
import { buildContextMessages } from '../../src/context/context.js';
import { SUBAGENT_MESSAGE_PREFIX, type SessionEvent } from '../../src/session/types.js';
import { textOf, type Message } from '../../src/llm/types.js';
import { text } from '../helpers/parts.js';

function build(events: unknown[]): Message[] {
  return buildContextMessages(events as SessionEvent[]);
}

const messageContent = (from: string, body: string) =>
  `${SUBAGENT_MESSAGE_PREFIX}\n${from}\n${body}`;

describe('subagent_message 的入模形态', () => {
  it('以 user 角色注入，正文与该智能体来信逐字保留', () => {
    const content = messageContent(
      '以下是来自于当前主智能体（id：root-1）的信息',
      'please report status'
    );
    const messages = build([
      { type: 'assistant', turnId: 1, content: 'waiting for instructions', toolCalls: [] },
      { type: 'subagent_message', sessionId: 'root-1', agentName: '', content },
    ]);

    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('user');
    // 与相邻 user 消息合并后，末尾仍是这条来信的原文
    expect(textOf(last.content).endsWith(content)).toBe(true);
    expect(textOf(last.content).startsWith(SUBAGENT_MESSAGE_PREFIX)).toBe(true);
  });

  it('不改动 tool 配对过滤：夹在工具序列中不破坏配对', () => {
    const messages = build([
      { type: 'user', turnId: 1, content: text('go') },
      {
        type: 'assistant',
        turnId: 1,
        content: '',
        toolCalls: [{ id: 'tc1', name: 'spawn_agent', arguments: '{}' }],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'spawn_agent',
        toolCallId: 'tc1',
        output: 'spawned build (child-1)',
      },
      {
        type: 'subagent_message',
        sessionId: 'child-1',
        agentName: 'build',
        content: messageContent('以下是来自于（build）智能体（id：child-1）的信息', 'got it'),
      },
    ]);

    // 配对完好：assistant(tool_calls) 与对应 tool 结果都在
    expect(messages.some((m) => m.role === 'assistant' && m.tool_calls?.length)).toBe(true);
    expect(messages.some((m) => m.role === 'tool' && m.tool_call_id === 'tc1')).toBe(true);
    expect(messages[messages.length - 1]!.role).toBe('user');
  });
});
