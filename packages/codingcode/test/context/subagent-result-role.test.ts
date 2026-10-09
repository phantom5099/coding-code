import { describe, it, expect } from 'vitest';
import { buildContextMessages } from '../../src/context/context.js';
import { SUBAGENT_RESULT_PREFIX, type SessionEvent } from '../../src/session/types.js';
import { textOf, type Message } from '../../src/llm/types.js';
import { text } from '../helpers/parts.js';

function build(events: unknown[]): Message[] {
  return buildContextMessages(events as SessionEvent[]);
}

const resultContent = (payload: string) =>
  `${SUBAGENT_RESULT_PREFIX}\nTask name: parent-1\nSender: child-1\nPayload:\n${payload}`;

describe('subagent_result 的入模形态', () => {
  it('以 user 角色注入，且保留正文首行的判别标记', () => {
    const messages = build([
      { type: 'user', turnId: 1, content: text('delegate this') },
      {
        type: 'assistant',
        turnId: 1,
        content: 'working on it',
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
        type: 'subagent_result',
        sessionId: 'child-1',
        agentName: 'build',
        content: resultContent('hello'),
      },
    ]);

    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(textOf(last.content).startsWith(SUBAGENT_RESULT_PREFIX)).toBe(true);
  });

  it('绝不让 prompt 以 assistant 结尾（回归：模型空回复导致回合静默结束）', () => {
    const messages = build([
      { type: 'user', turnId: 1, content: text('delegate this') },
      {
        type: 'assistant',
        turnId: 1,
        content: '',
        toolCalls: [{ id: 'tc1', name: 'wait_agent', arguments: '{}' }],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'wait_agent',
        toolCallId: 'tc1',
        output: 'completed',
      },
      {
        type: 'subagent_result',
        sessionId: 'child-1',
        agentName: 'build',
        content: resultContent('done'),
      },
    ]);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[messages.length - 1]!.role).not.toBe('assistant');
  });
});
