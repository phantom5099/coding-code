import { describe, it, expect, beforeEach } from 'vitest';
import { useGlobalStore } from '../src/stores/global.store';
import type { TodoItem } from '../shared/types';

beforeEach(() => {
  useGlobalStore.setState({
    agent: {
      currentThreadId: null,
      threads: {},
      approvalPolicy: 'suggest',
      model: '',
      models: [],
      contextUsage: null,
      todoByThreadId: {},
    },
    workspace: {
      rootPath: '',
      name: '',
      projects: [],
      currentProjectId: '',
    },
  });
});

function makeItems(): TodoItem[] {
  return [
    { step: '第一步', status: 'completed' },
    { step: '第二步', status: 'in_progress' },
    { step: '第三步', status: 'pending' },
  ];
}

describe('applyTodoUpdate', () => {
  it('sets hasSeenNonEmptyTodo when receiving non-empty items', () => {
    useGlobalStore.getState().applyTodoUpdate('t1', makeItems());

    const state = useGlobalStore.getState().agent.todoByThreadId['t1']!;
    expect(state).toBeDefined();
    expect(state.hasSeenNonEmptyTodo).toBe(true);
    expect(state.items).toHaveLength(3);
    expect(state.collapsed).toBe(false);
  });

  it('replaces previous items when receiving new non-empty items', () => {
    useGlobalStore.getState().applyTodoUpdate('t1', makeItems());
    useGlobalStore.getState().applyTodoUpdate('t1', [{ step: '新任务', status: 'pending' }]);

    const state = useGlobalStore.getState().agent.todoByThreadId['t1']!;
    expect(state.items).toHaveLength(1);
    expect(state.items[0].step).toBe('新任务');
    expect(state.hasSeenNonEmptyTodo).toBe(true);
  });

  it('retains old items when receiving empty update after having seen non-empty', () => {
    useGlobalStore.getState().applyTodoUpdate('t1', makeItems());
    useGlobalStore.getState().applyTodoUpdate('t1', []);

    const state = useGlobalStore.getState().agent.todoByThreadId['t1']!;
    expect(state.hasSeenNonEmptyTodo).toBe(true);
    expect(state.items).toHaveLength(3);
  });

  it('does not mark hasSeenNonEmptyTodo when receiving empty items for a new thread', () => {
    useGlobalStore.getState().applyTodoUpdate('t1', []);

    const state = useGlobalStore.getState().agent.todoByThreadId['t1']!;
    expect(state.hasSeenNonEmptyTodo).toBe(false);
    expect(state.items).toHaveLength(0);
  });

  it('is isolated by threadId', () => {
    useGlobalStore.getState().applyTodoUpdate('t1', makeItems());
    useGlobalStore.getState().applyTodoUpdate('t2', [{ step: 't2任务', status: 'completed' }]);

    const s1 = useGlobalStore.getState().agent.todoByThreadId['t1']!;
    const s2 = useGlobalStore.getState().agent.todoByThreadId['t2']!;

    expect(s1.items).toHaveLength(3);
    expect(s2.items).toHaveLength(1);
    expect(s2.items[0].step).toBe('t2任务');
  });
});

describe('toggleTodoCollapsed', () => {
  it('toggles collapsed state', () => {
    useGlobalStore.getState().applyTodoUpdate('t1', makeItems());
    expect(useGlobalStore.getState().agent.todoByThreadId['t1']!.collapsed).toBe(false);

    useGlobalStore.getState().toggleTodoCollapsed('t1');
    expect(useGlobalStore.getState().agent.todoByThreadId['t1']!.collapsed).toBe(true);

    useGlobalStore.getState().toggleTodoCollapsed('t1');
    expect(useGlobalStore.getState().agent.todoByThreadId['t1']!.collapsed).toBe(false);
  });

  it('is isolated by threadId', () => {
    useGlobalStore.getState().applyTodoUpdate('t1', makeItems());
    useGlobalStore.getState().applyTodoUpdate('t2', makeItems());

    useGlobalStore.getState().toggleTodoCollapsed('t1');

    expect(useGlobalStore.getState().agent.todoByThreadId['t1']!.collapsed).toBe(true);
    expect(useGlobalStore.getState().agent.todoByThreadId['t2']!.collapsed).toBe(false);
  });
});

describe('Todo summary statistics', () => {
  it('counts statuses correctly', () => {
    useGlobalStore.getState().applyTodoUpdate('t1', [
      { step: 'a', status: 'pending' },
      { step: 'b', status: 'pending' },
      { step: 'c', status: 'in_progress' },
      { step: 'd', status: 'completed' },
    ]);

    const items = useGlobalStore.getState().agent.todoByThreadId['t1']!.items;
    const pending = items.filter((i: TodoItem) => i.status === 'pending').length;
    const inProgress = items.filter((i: TodoItem) => i.status === 'in_progress').length;
    const completed = items.filter((i: TodoItem) => i.status === 'completed').length;

    expect(pending).toBe(2);
    expect(inProgress).toBe(1);
    expect(completed).toBe(1);
  });

  it('identifies all-completed state', () => {
    useGlobalStore.getState().applyTodoUpdate('t1', [
      { step: 'a', status: 'completed' },
      { step: 'b', status: 'completed' },
    ]);

    const items = useGlobalStore.getState().agent.todoByThreadId['t1']!.items;
    const allCompleted = items.length > 0 && items.every((i: TodoItem) => i.status === 'completed');

    expect(allCompleted).toBe(true);
  });
});
