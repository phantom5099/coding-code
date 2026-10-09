import { describe, it } from 'vitest';
import type { UITurn, UITurnItem } from '../../src/session/types.js';
import type { TodoItem } from '../../src/todo/types.js';

// 本文件只做编译期类型约束（tsc 执行 @ts-expect-error 校验），不含运行时断言。
describe('类型收口', () => {
  it('UITurn.status 不接受任意字符串', () => {
    // @ts-expect-error status 只能是三个字面量之一
    const bad: UITurn = { id: '1', items: [], status: 'nope' };
    void bad;
  });

  it('UITurnItem 覆盖 session 产出的全部变体', () => {
    const items: UITurnItem[] = [
      { id: 'a', type: 'message', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'b', type: 'tool_call', name: 'read_file', args: {}, status: 'approved' },
      { id: 'c', type: 'tool_result', callId: 'b', name: 'read_file', output: 'ok' },
      { id: 'd', type: 'summary', content: 's', startTurnId: 1, endTurnId: 2 },
      { id: 'e', type: 'reasoning', content: 'r', isVisible: false },
      { id: 'f', type: 'error', message: 'e' },
    ];
    void items;
  });

  it('TodoItem.status 是字面量联合而非 string', () => {
    // @ts-expect-error status 只能是 pending / in_progress / completed
    const bad: TodoItem = { step: 'x', status: 'whatever' };
    void bad;
  });
});
