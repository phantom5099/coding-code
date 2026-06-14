import { describe, it, expect } from 'vitest';
import type { Item, Turn } from '../shared/types';

function buildAssistantContentByTurnId(turns: Turn[]): Map<string, string> {
  const contentMap = new Map<string, string>();
  for (const turn of turns) {
    const assistantParts: string[] = [];
    for (const item of turn.items) {
      if (item.type === 'message' && item.role === 'assistant' && item.content) {
        assistantParts.push(item.content);
      }
    }
    if (assistantParts.length > 0) {
      contentMap.set(turn.id, assistantParts.join('\n\n'));
    }
  }
  return contentMap;
}

function makeMsg(role: 'user' | 'assistant', content: string): Item {
  return { id: 'm-' + content, type: 'message', role, content };
}

function makeToolCall(
  name: string,
  status: 'pending' | 'running' | 'approved' | 'rejected',
  id?: string
): Item {
  return { id: id ?? 'tc-' + name, type: 'tool_call', name, args: {}, status };
}

function makeToolResult(callId: string, output?: string): Item {
  return { id: 'tr-' + callId, type: 'tool_result', callId, output: output ?? 'ok' };
}

describe('assistantContentByTurnId', () => {
  it('concatenates multiple assistant messages in one turn with double newline', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [
          makeMsg('user', 'hello'),
          makeMsg('assistant', 'I will help'),
          makeToolCall('read_file', 'approved', 'tc-1'),
          makeToolResult('tc-1', 'file content'),
          makeMsg('assistant', 'Here is the result'),
        ],
        status: 'completed',
      },
    ];
    const map = buildAssistantContentByTurnId(turns);
    expect(map.get('t1')).toBe('I will help\n\nHere is the result');
  });

  it('returns single message content when only one assistant message exists', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [makeMsg('user', 'hi'), makeMsg('assistant', 'hello')],
        status: 'completed',
      },
    ];
    const map = buildAssistantContentByTurnId(turns);
    expect(map.get('t1')).toBe('hello');
  });

  it('does not include turn with no assistant messages', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [makeMsg('user', 'hi')],
        status: 'completed',
      },
    ];
    const map = buildAssistantContentByTurnId(turns);
    expect(map.has('t1')).toBe(false);
  });

  it('handles multiple turns independently', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [makeMsg('user', 'a'), makeMsg('assistant', 'reply-a')],
        status: 'completed',
      },
      {
        id: 't2',
        items: [
          makeMsg('user', 'b'),
          makeMsg('assistant', 'reply-b1'),
          makeMsg('assistant', 'reply-b2'),
        ],
        status: 'completed',
      },
    ];
    const map = buildAssistantContentByTurnId(turns);
    expect(map.get('t1')).toBe('reply-a');
    expect(map.get('t2')).toBe('reply-b1\n\nreply-b2');
  });

  it('ignores empty assistant messages', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [
          makeMsg('user', 'hi'),
          { id: 'm-empty', type: 'message', role: 'assistant', content: '' },
          makeMsg('assistant', 'actual content'),
        ],
        status: 'completed',
      },
    ];
    const map = buildAssistantContentByTurnId(turns);
    expect(map.get('t1')).toBe('actual content');
  });

  it('handles interrupted turn with error status', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [
          makeMsg('user', 'do something'),
          makeMsg('assistant', 'partial response'),
          makeToolCall('bash', 'running', 'tc-1'),
        ],
        status: 'error',
      },
    ];
    const map = buildAssistantContentByTurnId(turns);
    expect(map.get('t1')).toBe('partial response');
  });

  it('handles turn with only tool calls and no assistant text', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [
          makeMsg('user', 'run it'),
          makeToolCall('bash', 'approved', 'tc-1'),
          makeToolResult('tc-1', 'done'),
        ],
        status: 'completed',
      },
    ];
    const map = buildAssistantContentByTurnId(turns);
    expect(map.has('t1')).toBe(false);
  });
});
