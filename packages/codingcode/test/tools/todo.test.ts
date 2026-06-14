import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { TodoService } from '../../src/agent/todo.js';
import { createTodoWriteTool } from '../../src/tools/domains/self/todo-write.js';

async function makeTodoTool() {
  return Effect.runPromise(createTodoWriteTool().pipe(Effect.provide(TodoService.Default)));
}

describe('todo_write tool', () => {
  it('is a core tool (not deferred)', async () => {
    const tool = await makeTodoTool();
    expect(tool.deferred).not.toBe(true);
  });

  it('returns pending/in_progress/completed counts', async () => {
    const tool = await makeTodoTool();
    const result = await Effect.runPromise(
      tool.execute(
        {
          plan: [
            { step: 'first', status: 'pending' },
            { step: 'second', status: 'in_progress' },
            { step: 'third', status: 'completed' },
          ],
        },
        { sessionId: 'test-agent' }
      )
    );
    expect(result).toBe('pending=1 in_progress=1 completed=1');
  });

  it('rejects plan exceeding TODO_MAX_ITEMS (20)', async () => {
    const tool = await makeTodoTool();
    const plan = Array.from({ length: 21 }, (_, i) => ({
      step: `step ${i}`,
      status: 'pending' as const,
    }));
    await expect(tool.parameters.parseAsync({ plan })).rejects.toThrow();
  });

  it('rejects step longer than 60 chars', async () => {
    const tool = await makeTodoTool();
    await expect(
      tool.parameters.parseAsync({
        plan: [{ step: 'x'.repeat(61), status: 'pending' }],
      })
    ).rejects.toThrow();
  });

  it('rejects invalid status value', async () => {
    const tool = await makeTodoTool();
    await expect(
      tool.parameters.parseAsync({
        plan: [{ step: 'test', status: 'invalid' }],
      })
    ).rejects.toThrow();
  });

  it('does not accept cancelled status', async () => {
    const tool = await makeTodoTool();
    await expect(
      tool.parameters.parseAsync({
        plan: [{ step: 'test', status: 'cancelled' }],
      })
    ).rejects.toThrow();
  });

  it('fails with AgentError if sessionId is missing', async () => {
    const tool = await makeTodoTool();
    const exit = await Effect.runPromiseExit(
      tool.execute({ plan: [{ step: 'x', status: 'pending' }] }, {})
    );
    expect(exit._tag).toBe('Failure');
  });
});
