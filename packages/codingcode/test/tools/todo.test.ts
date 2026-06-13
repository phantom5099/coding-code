import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { TodoService } from '../../src/agent/todo.js';
import { todoWriteTool } from '../../src/tools/domains/self/todo-write.js';

describe('todo_write tool', () => {
  it('is a core tool (not deferred)', () => {
    expect(todoWriteTool.deferred).not.toBe(true);
  });

  it('returns pending/in_progress/completed counts', async () => {
    const result = await Effect.runPromise(
      todoWriteTool.execute(
        {
          plan: [
            { step: 'first', status: 'pending' },
            { step: 'second', status: 'in_progress' },
            { step: 'third', status: 'completed' },
          ],
        },
        { sessionId: 'test-agent' }
      ).pipe(Effect.provide(TodoService.Default))
    );
    expect(result).toBe('pending=1 in_progress=1 completed=1');
  });

  it('rejects plan exceeding TODO_MAX_ITEMS (20)', async () => {
    const plan = Array.from({ length: 21 }, (_, i) => ({
      step: `step ${i}`,
      status: 'pending' as const,
    }));
    await expect(todoWriteTool.parameters.parseAsync({ plan })).rejects.toThrow();
  });

  it('rejects step longer than 60 chars', async () => {
    await expect(
      todoWriteTool.parameters.parseAsync({
        plan: [{ step: 'x'.repeat(61), status: 'pending' }],
      })
    ).rejects.toThrow();
  });

  it('rejects invalid status value', async () => {
    await expect(
      todoWriteTool.parameters.parseAsync({
        plan: [{ step: 'test', status: 'invalid' }],
      })
    ).rejects.toThrow();
  });

  it('does not accept cancelled status', async () => {
    await expect(
      todoWriteTool.parameters.parseAsync({
        plan: [{ step: 'test', status: 'cancelled' }],
      })
    ).rejects.toThrow();
  });

  it('fails with AgentError if sessionId is missing', async () => {
    const exit = await Effect.runPromiseExit(
      todoWriteTool.execute({ plan: [{ step: 'x', status: 'pending' }] }, {}).pipe(
        Effect.provide(TodoService.Default)
      )
    );
    expect(exit._tag).toBe('Failure');
  });
});
