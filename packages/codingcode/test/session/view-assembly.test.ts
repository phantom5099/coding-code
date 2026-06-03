import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { buildMessagesFromEvents } from '../../src/session/messages.js';
import type { SessionEvent } from '../../src/session/types.js';

function makeEvents(overrides: Partial<SessionEvent>[] = []): SessionEvent[] {
  const base: SessionEvent[] = [
    {
      type: 'session_meta',
      sessionId: 's1',
      projectPath: 'p',
      cwd: '/tmp',
      model: 'test',
      createdAt: new Date().toISOString(),
    },
    { type: 'user', turnId: 1, uuid: 'u1', content: 'hello', timestamp: new Date().toISOString() },
    {
      type: 'assistant',
      turnId: 1,
      uuid: 'a1',
      content: 'hi there',
      toolCalls: [],
      model: 'test',
      timestamp: new Date().toISOString(),
    },
    {
      type: 'user',
      turnId: 2,
      uuid: 'u2',
      content: 'run a command',
      timestamp: new Date().toISOString(),
    },
    {
      type: 'assistant',
      turnId: 2,
      uuid: 'a2',
      content: 'running...',
      toolCalls: [{ id: 'tc1', name: 'bash', arguments: {} }],
      model: 'test',
      timestamp: new Date().toISOString(),
    },
    {
      type: 'tool_result',
      turnId: 2,
      uuid: 't1',
      parentUuid: 'a2',
      toolName: 'bash',
      toolCallId: 'tc1',
      output: 'output line 1\nline 2',
      timestamp: new Date().toISOString(),
      tokenCount: 10,
    },
    { type: 'user', turnId: 3, uuid: 'u3', content: 'thanks', timestamp: new Date().toISOString() },
    {
      type: 'assistant',
      turnId: 3,
      uuid: 'a3',
      content: 'welcome',
      toolCalls: [],
      model: 'test',
      timestamp: new Date().toISOString(),
    },
  ];
  // Merge overrides by type+uuid match
  for (const ov of overrides) {
    const idx = base.findIndex(
      (e) => 'uuid' in e && 'uuid' in ov && (e as any).uuid === (ov as any).uuid
    );
    if (idx !== -1) base[idx] = ov;
    else base.push(ov);
  }
  return base;
}

describe('buildMessagesFromEvents', () => {
  it('converts user/assistant/tool_result events to messages', () => {
    const events = makeEvents();
    const messages = buildMessagesFromEvents(events);
    // session_meta is filtered out; 7 visible events 鈫?7 messages
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
        replaces: ['t1'],
        summaryText: '[compacted]',
        method: 'prune',
        timestamp: new Date().toISOString(),
      } as any,
    ]);
    const messages = buildMessagesFromEvents(events);
    // t1 is hidden, summary appears as system message
    const toolMessages = messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(0);
    const summaryMessages = messages.filter((m) => m.role === 'system');
    expect(summaryMessages).toHaveLength(1);
    expect(summaryMessages[0]?.content).toBe('[compacted]');
  });

  it('hide(kind=message) removes the target message from the view', () => {
    const events = makeEvents([
      {
        type: 'hide',
        uuid: 'h1',
        kind: 'message',
        targetUuid: 'u2',
        reason: 'user deleted',
        timestamp: new Date().toISOString(),
      } as any,
    ]);
    const messages = buildMessagesFromEvents(events);
    // u2 is hidden, so the view should not contain "run a command"
    const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).not.toContain('run a command');
    expect(userContents).toContain('hello');
    expect(userContents).toContain('thanks');
  });

  it('hide(kind=rollback) removes all events from the given turn onwards', () => {
    const events = makeEvents([
      {
        type: 'hide',
        uuid: 'h1',
        kind: 'rollback',
        throughTurnId: 1,
        reason: 'rollback',
        timestamp: new Date().toISOString(),
      } as any,
    ]);
    const messages = buildMessagesFromEvents(events);
    // Turn 1 events should also be hidden (>= semantics)
    const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual([]);
    const assistantContents = messages.filter((m) => m.role === 'assistant').map((m) => m.content);
    expect(assistantContents).toEqual([]);
  });

  it('unhide restores previously hidden messages', () => {
    const events = makeEvents([
      {
        type: 'hide',
        uuid: 'h1',
        kind: 'message',
        targetUuid: 'u2',
        reason: 'user deleted',
        timestamp: new Date().toISOString(),
      } as any,
      {
        type: 'unhide',
        uuid: 'uh1',
        targetHideUuid: 'h1',
        timestamp: new Date().toISOString(),
      } as any,
    ]);
    const messages = buildMessagesFromEvents(events);
    // u2 should be restored
    const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toContain('run a command');
  });

  it('unhide after rollback restores rolled-back messages', () => {
    const events = makeEvents([
      {
        type: 'hide',
        uuid: 'h1',
        kind: 'rollback',
        throughTurnId: 1,
        reason: 'rollback',
        timestamp: new Date().toISOString(),
      } as any,
      {
        type: 'unhide',
        uuid: 'uh1',
        targetHideUuid: 'h1',
        timestamp: new Date().toISOString(),
      } as any,
    ]);
    const messages = buildMessagesFromEvents(events);
    // All messages should be visible again
    const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual(['hello', 'run a command', 'thanks']);
  });

  it('strips trailing assistant messages with unresolved tool_calls', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        model: 'test',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        uuid: 'u1',
        content: 'do something',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'ok',
        toolCalls: [{ id: 'tc1', name: 'bash', arguments: {} }],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      // Missing tool_result for tc1
    ];
    const messages = buildMessagesFromEvents(events);
    // The trailing assistant with unresolved tool_call should be stripped
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
        model: 'test',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        uuid: 'u1',
        content: 'step 1',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'ok',
        toolCalls: [
          { id: 'tc1', name: 'bash', arguments: {} },
          { id: 'tc2', name: 'read', arguments: {} },
        ],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 't1',
        parentUuid: 'a1',
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'bash output',
        timestamp: new Date().toISOString(),
        tokenCount: 10,
      },
      {
        type: 'user',
        turnId: 2,
        uuid: 'u2',
        content: 'step 2',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant',
        turnId: 2,
        uuid: 'a2',
        content: 'done',
        toolCalls: [],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      // tc2's tool_result is missing (e.g. hidden by summary)
    ];
    const messages = buildMessagesFromEvents(events);
    // a1 has unresolved tc2 鈫?entire a1 and its matched tc1 result should be removed
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
        model: 'test',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        uuid: 'u1',
        content: 'do something',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'ok',
        toolCalls: [{ id: 'tc1', name: 'bash', arguments: {} }],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 't1',
        parentUuid: 'a1',
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'old output',
        timestamp: new Date().toISOString(),
        tokenCount: 10,
      },
      {
        type: 'summary',
        uuid: 's1',
        replaces: ['t1'],
        summaryText: '[compacted]',
        method: 'prune',
        timestamp: new Date().toISOString(),
      },
      { type: 'user', turnId: 2, uuid: 'u2', content: 'next', timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        turnId: 2,
        uuid: 'a2',
        content: 'done',
        toolCalls: [],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
    ];
    const messages = buildMessagesFromEvents(events);
    // a1 should be removed because tc1 is hidden by summary
    const assistantContents = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => (m as any).content);
    expect(assistantContents).toEqual(['done']);
    // No tool messages should remain
    expect(messages.filter((m) => m.role === 'tool')).toHaveLength(0);
    // Summary should remain as system
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
        model: 'test',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        uuid: 'u1',
        content: 'first',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'ok',
        toolCalls: [
          { id: 'tc1', name: 'bash', arguments: {} },
          { id: 'tc2', name: 'bash', arguments: {} },
        ],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 't1',
        parentUuid: 'a1',
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'out1',
        timestamp: new Date().toISOString(),
        tokenCount: 10,
      },
      {
        type: 'user',
        turnId: 2,
        uuid: 'u2',
        content: 'second',
        timestamp: new Date().toISOString(),
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
        model: 'test',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        uuid: 'u1',
        content: 'do something',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'ok',
        toolCalls: [
          { id: 'tc1', name: 'bash', arguments: {} },
          { id: 'tc2', name: 'bash', arguments: {} },
        ],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 't1',
        parentUuid: 'a1',
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'out1',
        timestamp: new Date().toISOString(),
        tokenCount: 10,
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 't2',
        parentUuid: 'a1',
        toolName: 'bash',
        toolCallId: 'tc2',
        output: 'out2',
        timestamp: new Date().toISOString(),
        tokenCount: 10,
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
        model: 'test',
        createdAt: new Date().toISOString(),
      },
      { type: 'user', turnId: 1, uuid: 'u1', content: 'q1', timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'reply1',
        toolCalls: [],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant',
        turnId: 2,
        uuid: 'a2',
        content: 'reply2',
        toolCalls: [],
        model: 'test',
        timestamp: new Date().toISOString(),
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
