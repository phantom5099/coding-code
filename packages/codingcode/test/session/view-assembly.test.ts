import { describe, it, expect } from 'vitest';
import { buildMessagesFromEvents } from '../../src/session/messages.js';
import type { SessionEvent } from '../../src/session/types.js';

function makeEvents(extra: SessionEvent[] = []): SessionEvent[] {
  const base: SessionEvent[] = [
    {
      type: 'session_meta',
      sessionId: 's1',
      projectPath: 'p',
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
    },
    { type: 'user', turnId: 1, content: 'hello' },
    {
      type: 'assistant',
      turnId: 1,
      content: 'hi there',
      toolCalls: [],
    },
    {
      type: 'user',
      turnId: 2,
      content: 'run a command',
    },
    {
      type: 'assistant',
      turnId: 2,
      content: 'running...',
      toolCalls: [{ id: 'tc1', name: 'bash', arguments: {} }],
    },
    {
      type: 'tool_result',
      turnId: 2,
      toolName: 'bash',
      toolCallId: 'tc1',
      output: 'output line 1\nline 2',
    },
    { type: 'user', turnId: 3, content: 'thanks' },
    {
      type: 'assistant',
      turnId: 3,
      content: 'welcome',
      toolCalls: [],
    },
  ];
  return [...base, ...extra];
}

describe('buildMessagesFromEvents', () => {
  it('converts user/assistant/tool_result events to messages', () => {
    const events = makeEvents();
    const messages = buildMessagesFromEvents(events);
    expect(messages).toHaveLength(7);
    expect(messages[0]).toEqual({ role: 'user', content: 'hello' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'hi there' });
    expect(messages[2]).toEqual({ role: 'user', content: 'run a command' });
    expect(messages[3]?.role).toBe('assistant');
    expect((messages[3] as any).tool_calls).toHaveLength(1);
    expect(messages[4]?.role).toBe('tool');
    expect(messages[5]).toEqual({ role: 'user', content: 'thanks' });
    expect(messages[6]).toEqual({ role: 'assistant', content: 'welcome' });
  });

  it('summary events hide replaced events and emit as system message', () => {
    const events = makeEvents([
      {
        type: 'summary',
        uuid: 's1',
        startTurnId: 1,
        endTurnId: 2,
        summaryText: '[compacted]',
      },
    ]);
    const messages = buildMessagesFromEvents(events);
    const toolMessages = messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(0);
    const summaryMessages = messages.filter((m) => m.role === 'system');
    expect(summaryMessages).toHaveLength(1);
    expect(summaryMessages[0]?.content).toBe('[compacted]');
  });

  it('rollback removes all events from the given turn onwards', () => {
    const events = makeEvents([
      {
        type: 'rollback',
        throughTurnId: 1,
        reason: 'rollback',
      },
    ]);
    const messages = buildMessagesFromEvents(events);
    const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual([]);
    const assistantContents = messages.filter((m) => m.role === 'assistant').map((m) => m.content);
    expect(assistantContents).toEqual([]);
  });

  it('strips trailing assistant messages with unresolved tool_calls', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        content: 'do something',
      },
      {
        type: 'assistant',
        turnId: 1,
        content: 'ok',
        toolCalls: [{ id: 'tc1', name: 'bash', arguments: {} }],
      },
    ];
    const messages = buildMessagesFromEvents(events);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: 'user', content: 'do something' });
  });

  it('filters assistant with partially resolved tool_calls and their orphaned tool results', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        content: 'step 1',
      },
      {
        type: 'assistant',
        turnId: 1,
        content: 'ok',
        toolCalls: [
          { id: 'tc1', name: 'bash', arguments: {} },
          { id: 'tc2', name: 'read', arguments: {} },
        ],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'bash output',
      },
      {
        type: 'user',
        turnId: 2,
        content: 'step 2',
      },
      {
        type: 'assistant',
        turnId: 2,
        content: 'done',
        toolCalls: [],
      },
    ];
    const messages = buildMessagesFromEvents(events);
    expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect((messages.find((m) => m.role === 'assistant') as any).content).toBe('done');
    expect(messages.filter((m) => m.role === 'tool')).toHaveLength(0);
  });

  it('removes assistant when summary hides its tool_results but not the assistant itself', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        content: 'do something',
      },
      {
        type: 'assistant',
        turnId: 1,
        content: 'ok',
        toolCalls: [{ id: 'tc1', name: 'bash', arguments: {} }],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'old output',
      },
      {
        type: 'summary',
        uuid: 's1',
        startTurnId: 1,
        endTurnId: 1,
        summaryText: '[compacted]',
      },
      { type: 'user', turnId: 2, content: 'next' },
      {
        type: 'assistant',
        turnId: 2,
        content: 'done',
        toolCalls: [],
      },
    ];
    const messages = buildMessagesFromEvents(events);
    const assistantContents = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => (m as any).content);
    expect(assistantContents).toEqual(['done']);
    expect(messages.filter((m) => m.role === 'tool')).toHaveLength(0);
    expect(messages.filter((m) => m.role === 'system').map((m) => m.content)).toContain(
      '[compacted]'
    );
  });

  it('merges adjacent user messages after filtering out an unresolved assistant', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        content: 'first',
      },
      {
        type: 'assistant',
        turnId: 1,
        content: 'ok',
        toolCalls: [
          { id: 'tc1', name: 'bash', arguments: {} },
          { id: 'tc2', name: 'bash', arguments: {} },
        ],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'out1',
      },
      {
        type: 'user',
        turnId: 2,
        content: 'second',
      },
    ];
    const messages = buildMessagesFromEvents(events);
    const userMsgs = messages.filter((m) => m.role === 'user');
    expect(userMsgs).toHaveLength(1);
    expect((userMsgs[0] as any).content).toContain('first');
    expect((userMsgs[0] as any).content).toContain('second');
  });

  it('does not merge adjacent tool messages', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        content: 'do something',
      },
      {
        type: 'assistant',
        turnId: 1,
        content: 'ok',
        toolCalls: [
          { id: 'tc1', name: 'bash', arguments: {} },
          { id: 'tc2', name: 'bash', arguments: {} },
        ],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'out1',
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'bash',
        toolCallId: 'tc2',
        output: 'out2',
      },
    ];
    const messages = buildMessagesFromEvents(events);
    expect(messages.filter((m) => m.role === 'tool')).toHaveLength(2);
  });

  it('merges adjacent plain assistant messages without tool_calls', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      { type: 'user', turnId: 1, content: 'q1' },
      {
        type: 'assistant',
        turnId: 1,
        content: 'reply1',
        toolCalls: [],
      },
      {
        type: 'assistant',
        turnId: 2,
        content: 'reply2',
        toolCalls: [],
      },
    ];
    const messages = buildMessagesFromEvents(events);
    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect((assistantMsgs[0] as any).content).toContain('reply1');
    expect((assistantMsgs[0] as any).content).toContain('reply2');
  });

  it('handles empty events list', () => {
    const messages = buildMessagesFromEvents([]);
    expect(messages).toHaveLength(0);
  });
});
