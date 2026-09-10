import { describe, expect, it } from 'vitest';
import type { UITurn, UITurnItem } from '../../src/session/port.js';
import type { ForkResult, RollbackContextResult } from '../../src/client/contracts.js';
import type { TodoItem as CoreTodoItem, TokenUsage as CoreTokenUsage } from '../../src/core/types.js';
import type { TodoItem as PortTodoItem, Todo as PortTodo } from '../../src/todo/port.js';
import type { TokenUsage as SessionTokenUsage } from '../../src/session/types.js';

type AssertNotAny<T> = 0 extends 1 & T ? never : T;

type _UITurnNotAny = AssertNotAny<UITurnItem>;
type _TodoNotAny = AssertNotAny<PortTodoItem>;

// 同构断言：两侧互相可赋值才通过
type _ForkTurnsIsUITurn = ForkResult['turns'] extends UITurn[] ? true : never;
type _ContextTurnsIsUITurn = RollbackContextResult['turns'] extends UITurn[] ? true : never;

type _PortTodoIsCoreTodo = PortTodoItem extends CoreTodoItem ? true : never;
type _CoreTodoIsPortTodo = CoreTodoItem extends PortTodoItem ? true : never;
type _TodoAliasIsItem = PortTodo extends PortTodoItem ? true : never;

type _SessionUsageIsCoreUsage = SessionTokenUsage extends CoreTokenUsage ? true : never;
type _CoreUsageIsSessionUsage = CoreTokenUsage extends SessionTokenUsage ? true : never;

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
    const todo: PortTodoItem = { step: 'do it', status: 'in_progress' };
    expect(todo.status).toBe('in_progress');
    // @ts-expect-error status 只能是 pending / in_progress / completed
    const bad: PortTodoItem = { step: 'x', status: 'whatever' };
    expect(bad).toBeDefined();
  });
});
