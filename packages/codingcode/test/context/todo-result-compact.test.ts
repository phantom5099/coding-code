import { describe, it, expect } from 'vitest';
import { buildContextMessages } from '../../src/context/context.js';
import type { SessionEvent } from '../../src/session/types.js';
import { textOf, type Message } from '../../src/llm/types.js';
import { text } from '../helpers/parts.js';

function build(events: unknown[], compactedTurnIds?: Set<number>): Message[] {
  return buildContextMessages(events as SessionEvent[], compactedTurnIds);
}

// > MICRO_COMPACT_MIN_CHARS(120)：真实 todo 回显的典型形态
const LONG_TODO_OUTPUT =
  'Current todo list (5 items):\n1. [pending] first\n2. [pending] second\n3. [pending] third\n4. [pending] fourth\n5. [pending] fifth';

function toolResult(turnId: number, toolName: string, id: string, output: string) {
  return { type: 'tool_result', turnId, toolName, toolCallId: id, output };
}

function toolMessages(messages: Message[]): Message[] {
  return messages.filter((m) => m.role === 'tool');
}

describe('todo 工具结果的 micro-compact', () => {
  it('压缩回合内的 todo_write/todo_read 结果替换为占位符，与普通工具同等待遇', () => {
    const messages = build(
      [
        { type: 'user', turnId: 1, content: text('do it') },
        {
          type: 'assistant',
          turnId: 1,
          content: '',
          toolCalls: [
            { id: 'tc1', name: 'todo_write', arguments: '{}' },
            { id: 'tc2', name: 'todo_read', arguments: '{}' },
            { id: 'tc3', name: 'read_file', arguments: '{}' },
          ],
        },
        toolResult(1, 'todo_write', 'tc1', LONG_TODO_OUTPUT),
        toolResult(1, 'todo_read', 'tc2', LONG_TODO_OUTPUT),
        toolResult(1, 'read_file', 'tc3', 'x'.repeat(200)),
      ],
      new Set([1])
    );

    const tools = toolMessages(messages);
    expect(textOf(tools[0]!.content)).toBe('[Earlier: used todo_write]');
    expect(textOf(tools[1]!.content)).toBe('[Earlier: used todo_read]');
    expect(textOf(tools[2]!.content)).toBe('[Earlier: used read_file]');
  });

  it('未压缩回合保留完整 todo 输出', () => {
    const messages = build(
      [
        { type: 'user', turnId: 1, content: text('do it') },
        {
          type: 'assistant',
          turnId: 1,
          content: '',
          toolCalls: [{ id: 'tc1', name: 'todo_write', arguments: '{}' }],
        },
        toolResult(1, 'todo_write', 'tc1', LONG_TODO_OUTPUT),
      ],
      new Set()
    );

    expect(textOf(toolMessages(messages)[0]!.content)).toBe(LONG_TODO_OUTPUT);
  });

  it('短输出不触发占位符替换（MICRO_COMPACT_MIN_CHARS 守卫）', () => {
    const short = 'Current todo list (1 item):\n1. [pending] a';
    const messages = build(
      [
        { type: 'user', turnId: 1, content: text('do it') },
        {
          type: 'assistant',
          turnId: 1,
          content: '',
          toolCalls: [{ id: 'tc1', name: 'todo_write', arguments: '{}' }],
        },
        toolResult(1, 'todo_write', 'tc1', short),
      ],
      new Set([1])
    );

    expect(textOf(toolMessages(messages)[0]!.content)).toBe(short);
  });
});
