import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { buildMessagesFromEvents } from '../../src/session/store.js';
import type { SessionEvent } from '../../src/session/types.js';

function makeEvents(overrides: Partial<SessionEvent>[] = []): SessionEvent[] {
  const base: SessionEvent[] = [
    { type: 'session_meta', sessionId: 's1', projectPath: 'p', cwd: '/tmp', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
    { type: 'user', turnId: 1, uuid: 'u1', content: 'hello', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 1, uuid: 'a1', content: 'hi there', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
    { type: 'user', turnId: 2, uuid: 'u2', content: 'run a command', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 2, uuid: 'a2', content: 'running...', toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{}' }], model: 'test', timestamp: new Date().toISOString() },
    { type: 'tool_result', turnId: 2, uuid: 't1', parentUuid: 'a2', toolName: 'bash', toolCallId: 'tc1', output: 'output line 1\nline 2', timestamp: new Date().toISOString(), tokenCount: 10 },
    { type: 'user', turnId: 3, uuid: 'u3', content: 'thanks', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 3, uuid: 'a3', content: 'welcome', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
  ];
  // Merge overrides by type+uuid match
  for (const ov of overrides) {
    const idx = base.findIndex((e) => 'uuid' in e && 'uuid' in ov && (e as any).uuid === (ov as any).uuid);
    if (idx !== -1) base[idx] = ov;
    else base.push(ov);
  }
  return base;
}

describe('buildMessagesFromEvents', () => {
  it('converts user/assistant/tool_result events to messages', () => {
    const events = makeEvents();
    const messages = buildMessagesFromEvents(events);
    // session_meta is filtered out; 7 visible events → 7 messages
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
      { type: 'summary', uuid: 's1', replaces: ['t1'], summaryText: '[compacted]', method: 'prune', timestamp: new Date().toISOString() } as any,
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
      { type: 'hide', uuid: 'h1', kind: 'message', targetUuid: 'u2', reason: 'user deleted', timestamp: new Date().toISOString() } as any,
    ]);
    const messages = buildMessagesFromEvents(events);
    // u2 is hidden, so the view should not contain "run a command"
    const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).not.toContain('run a command');
    expect(userContents).toContain('hello');
    expect(userContents).toContain('thanks');
  });

  it('hide(kind=rollback) removes all events after the given turn', () => {
    const events = makeEvents([
      { type: 'hide', uuid: 'h1', kind: 'rollback', throughTurnId: 1, reason: 'rollback', timestamp: new Date().toISOString() } as any,
    ]);
    const messages = buildMessagesFromEvents(events);
    // Turn 2 and 3 events should be hidden
    const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual(['hello']);
    const assistantContents = messages.filter((m) => m.role === 'assistant').map((m) => m.content);
    expect(assistantContents).toEqual(['hi there']);
  });

  it('unhide restores previously hidden messages', () => {
    const events = makeEvents([
      { type: 'hide', uuid: 'h1', kind: 'message', targetUuid: 'u2', reason: 'user deleted', timestamp: new Date().toISOString() } as any,
      { type: 'unhide', uuid: 'uh1', targetHideUuid: 'h1', timestamp: new Date().toISOString() } as any,
    ]);
    const messages = buildMessagesFromEvents(events);
    // u2 should be restored
    const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toContain('run a command');
  });

  it('unhide after rollback restores rolled-back messages', () => {
    const events = makeEvents([
      { type: 'hide', uuid: 'h1', kind: 'rollback', throughTurnId: 1, reason: 'rollback', timestamp: new Date().toISOString() } as any,
      { type: 'unhide', uuid: 'uh1', targetHideUuid: 'h1', timestamp: new Date().toISOString() } as any,
    ]);
    const messages = buildMessagesFromEvents(events);
    // All messages should be visible again
    const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual(['hello', 'run a command', 'thanks']);
  });

  it('strips trailing assistant messages with unresolved tool_calls', () => {
    const events: SessionEvent[] = [
      { type: 'session_meta', sessionId: 's1', projectPath: 'p', cwd: '/tmp', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
      { type: 'user', turnId: 1, uuid: 'u1', content: 'do something', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 1, uuid: 'a1', content: 'ok', toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{}' }], model: 'test', timestamp: new Date().toISOString() },
      // Missing tool_result for tc1
    ];
    const messages = buildMessagesFromEvents(events);
    // The trailing assistant with unresolved tool_call should be stripped
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: 'user', content: 'do something' });
  });

  it('handles empty events list', () => {
    const messages = buildMessagesFromEvents([]);
    expect(messages).toHaveLength(0);
  });
});
