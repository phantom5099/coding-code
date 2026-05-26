import { describe, it, expect, beforeEach } from 'vitest';
import { sharedTodoStore, countByStatus } from '../../../src/self/todo.js';
import type { Todo } from '../../../src/self/todo.js';

describe('TodoService (module-level store)', () => {
  beforeEach(() => { sharedTodoStore.reset(); });

  it('write then read returns full list', () => {
    const plan: Todo[] = [
      { step: 'step 1', status: 'pending' },
      { step: 'step 2', status: 'in_progress' },
      { step: 'step 3', status: 'completed' },
    ];
    sharedTodoStore.write('agent-a', plan);
    const got = sharedTodoStore.read('agent-a');
    expect(got).toEqual(plan);
  });

  it('different agentIds do not interfere', () => {
    sharedTodoStore.write('agent-a', [{ step: 'a1', status: 'pending' }]);
    sharedTodoStore.write('agent-b', [{ step: 'b1', status: 'completed' }]);
    expect(sharedTodoStore.read('agent-a')).toHaveLength(1);
    expect(sharedTodoStore.read('agent-b')).toHaveLength(1);
    expect(sharedTodoStore.read('agent-a')[0]!.step).toBe('a1');
    expect(sharedTodoStore.read('agent-b')[0]!.step).toBe('b1');
  });

  it('write replaces entirely (not append)', () => {
    sharedTodoStore.write('agent-r', [{ step: 'first', status: 'pending' }]);
    sharedTodoStore.write('agent-r', [{ step: 'second', status: 'completed' }]);
    const got = sharedTodoStore.read('agent-r');
    expect(got).toHaveLength(1);
    expect(got[0]!.step).toBe('second');
  });

  it('read returns empty array for unknown agentId', () => {
    expect(sharedTodoStore.read('unknown')).toEqual([]);
  });

  it('countByStatus counts correctly', () => {
    const plan: Todo[] = [
      { step: 'a', status: 'pending' },
      { step: 'b', status: 'completed' },
      { step: 'c', status: 'pending' },
      { step: 'd', status: 'in_progress' },
    ];
    expect(countByStatus(plan)).toEqual({ pending: 2, completed: 1, in_progress: 1 });
  });
});
