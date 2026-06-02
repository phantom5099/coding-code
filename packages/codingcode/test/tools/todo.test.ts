import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { sharedTodoStore } from '../../src/self/todo.js';
import { todoWriteTool } from '../../src/tools/domains/self/todo-write.js';
import { todoReadTool } from '../../src/tools/domains/self/todo-read.js';

beforeEach(() => { sharedTodoStore.reset(); });

describe('todo_write tool', () => {
  it('is a core tool (not deferred)', () => {
    expect(todoWriteTool.deferred).not.toBe(true);
  });

  it('returns pending/in_progress/completed counts', async () => {
    const result = await todoWriteTool.execute({
      plan: [
        { step: 'first', status: 'pending' },
        { step: 'second', status: 'in_progress' },
        { step: 'third', status: 'completed' },
      ],
    }, { sessionId: 'test-agent' });
    expect(result).toBe('pending=1 in_progress=1 completed=1');
  });

  it('rejects plan exceeding TODO_MAX_ITEMS (20)', async () => {
    const plan = Array.from({ length: 21 }, (_, i) => ({
      step: `step ${i}`,
      status: 'pending' as const,
    }));
    await expect(
      todoWriteTool.parameters.parseAsync({ plan }),
    ).rejects.toThrow();
  });

  it('rejects step longer than 60 chars', async () => {
    await expect(
      todoWriteTool.parameters.parseAsync({
        plan: [{ step: 'x'.repeat(61), status: 'pending' }],
      }),
    ).rejects.toThrow();
  });

  it('rejects invalid status value', async () => {
    await expect(
      todoWriteTool.parameters.parseAsync({
        plan: [{ step: 'test', status: 'invalid' }],
      }),
    ).rejects.toThrow();
  });

  it('does not accept cancelled status', async () => {
    await expect(
      todoWriteTool.parameters.parseAsync({
        plan: [{ step: 'test', status: 'cancelled' }],
      }),
    ).rejects.toThrow();
  });

  it('throws if sessionId is missing', async () => {
    await expect(
      todoWriteTool.execute({ plan: [{ step: 'x', status: 'pending' }] }, {}),
    ).rejects.toThrow('todo_write requires sessionId');
  });
});

describe('todo_read tool', () => {
  it('is a core tool (not deferred)', () => {
    expect(todoReadTool.deferred).not.toBe(true);
  });

  it('returns in_progress items first, then pending, completed last', async () => {
    sharedTodoStore.write('test-reader', [
      { step: 'Z completed', status: 'completed' },
      { step: 'A pending', status: 'pending' },
      { step: 'B in progress', status: 'in_progress' },
    ]);
    const result = await todoReadTool.execute({}, { sessionId: 'test-reader' });
    const lines = result.split('\n');
    expect(lines[0]).toBe('> B in progress');
    expect(lines[1]).toBe('- A pending');
    expect(lines[2]).toBe('+ Z completed');
  });

  it('returns (empty) for empty list', async () => {
    sharedTodoStore.write('test-empty', []);
    const result = await todoReadTool.execute({}, { sessionId: 'test-empty' });
    expect(result).toBe('(empty)');
  });

  it('throws if sessionId is missing', async () => {
    await expect(
      todoReadTool.execute({}, {}),
    ).rejects.toThrow('todo_read requires sessionId');
  });

  it('different sessionIds are isolated', async () => {
    sharedTodoStore.write('agent-alpha', [{ step: 'alpha work', status: 'pending' }]);
    sharedTodoStore.write('agent-beta', [{ step: 'beta work', status: 'completed' }]);
    const alphaResult = await todoReadTool.execute({}, { sessionId: 'agent-alpha' });
    const betaResult = await todoReadTool.execute({}, { sessionId: 'agent-beta' });
    expect(alphaResult).toContain('alpha work');
    expect(alphaResult).not.toContain('beta work');
    expect(betaResult).toContain('beta work');
  });
});
