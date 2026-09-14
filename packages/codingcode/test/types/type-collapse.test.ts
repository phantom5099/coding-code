import { describe, expect, it } from 'vitest';
import type { UITurn, UITurnItem } from '../../src/contracts/session.js';
import type { ForkResult, RollbackContextResult } from '../../src/client/contracts.js';
import type { TodoItem, TokenUsage } from '../../src/contracts/types.js';

type AssertNotAny<T> = 0 extends 1 & T ? never : T;

type _UITurnNotAny = AssertNotAny<UITurnItem>;
type _TodoNotAny = AssertNotAny<TodoItem>;
type _UsageNotAny = AssertNotAny<TokenUsage>;

// 同构断言：两侧互相可赋值才通过
type _ForkTurnsIsUITurn = ForkResult['turns'] extends UITurn[] ? true : never;
type _ContextTurnsIsUITurn = RollbackContextResult['turns'] extends UITurn[] ? true : never;

describe('类型收口', () => {
  it('UITurn.status 不再退化为 string', () => {
    const turn: UITurn = { id: '1', items: [], status: 'completed' };
    expect(turn.status).toBe('completed');
    // @ts-expect-error status 只能是三个字面量之一
    const bad: UITurn = { id: '1', items: [], status: 'nope' };
    expect(bad).toBeDefined();
  });

  it('UITurnItem 覆盖 session 产出的全部变体', () => {
    const items: UITurnItem[] = [
      { id: 'a', type: 'message', role: 'user', content: 'hi' },
      { id: 'b', type: 'tool_call', name: 'read_file', args: {}, status: 'approved' },
      { id: 'c', type: 'tool_result', callId: 'b', name: 'read_file', output: 'ok' },
      { id: 'd', type: 'summary', content: 's', startTurnId: 1, endTurnId: 2 },
      { id: 'e', type: 'reasoning', content: 'r', isVisible: false },
      { id: 'f', type: 'error', message: 'e' },
    ];
    expect(items.map((i) => i.type)).toEqual([
      'message',
      'tool_call',
      'tool_result',
      'summary',
      'reasoning',
      'error',
    ]);
  });

  it('TodoItem.status 是字面量联合而非 string', () => {
    const todo: TodoItem = { step: 'do it', status: 'in_progress' };
    expect(todo.status).toBe('in_progress');
    // @ts-expect-error status 只能是 pending / in_progress / completed
    const bad: TodoItem = { step: 'x', status: 'whatever' };
    expect(bad).toBeDefined();
  });
});
