import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { sharedTodoStore } from '../../src/agent-state/todo/service.js';
import { todoWriteTool } from '../../src/tools/domains/agent-state/todo-write.js';
import { todoReadTool } from '../../src/tools/domains/agent-state/todo-read.js';

beforeEach(() => { sharedTodoStore.reset(); });

describe('todo_write tool', () => {
  it('returns pending/completed/cancelled counts', async () => {
    const result = await todoWriteTool.execute({
      plan: [
        { step: 'first', status: 'pending' },
        { step: 'second', status: 'completed' },
        { step: 'third', status: 'cancelled' },
      ],
    }, { agentId: 'test-agent' });
    expect(result).toBe('pending=1 completed=1 cancelled=1');
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

  it('throws if agentId is missing', async () => {
    await expect(
      todoWriteTool.execute({ plan: [{ step: 'x', status: 'pending' }] }, {}),
    ).rejects.toThrow('todo_write requires agentId');
  });
});

describe('todo_read tool', () => {
  it('returns pending items first, completed items last', async () => {
    sharedTodoStore.write('test-reader', [
      { step: 'Z completed', status: 'completed' },
      { step: 'A pending', status: 'pending' },
      { step: 'B pending', status: 'pending' },
    ]);
    const result = await todoReadTool.execute({}, { agentId: 'test-reader' });
    const lines = result.split('\n');
    expect(lines[0]).toBe('- A pending');
    expect(lines[1]).toBe('- B pending');
    expect(lines[2]).toBe('+ Z completed');
  });

  it('does not return cancelled items', async () => {
    sharedTodoStore.write('test-cancel', [
      { step: 'alive', status: 'pending' },
      { step: 'dead', status: 'cancelled' },
    ]);
    const result = await todoReadTool.execute({}, { agentId: 'test-cancel' });
    expect(result).not.toContain('dead');
    expect(result).toContain('alive');
  });

  it('returns (empty) for empty list', async () => {
    sharedTodoStore.write('test-empty', []);
    const result = await todoReadTool.execute({}, { agentId: 'test-empty' });
    expect(result).toBe('(empty)');
  });

  it('returns (empty) when all items are cancelled', async () => {
    sharedTodoStore.write('test-all-cancel', [
      { step: 'dead', status: 'cancelled' },
    ]);
    const result = await todoReadTool.execute({}, { agentId: 'test-all-cancel' });
    expect(result).toBe('(empty)');
  });

  it('throws if agentId is missing', async () => {
    await expect(
      todoReadTool.execute({}, {}),
    ).rejects.toThrow('todo_read requires agentId');
  });

  it('different agentIds are isolated', async () => {
    sharedTodoStore.write('agent-alpha', [{ step: 'alpha work', status: 'pending' }]);
    sharedTodoStore.write('agent-beta', [{ step: 'beta work', status: 'completed' }]);
    const alphaResult = await todoReadTool.execute({}, { agentId: 'agent-alpha' });
    const betaResult = await todoReadTool.execute({}, { agentId: 'agent-beta' });
    expect(alphaResult).toContain('alpha work');
    expect(alphaResult).not.toContain('beta work');
    expect(betaResult).toContain('beta work');
  });
});
