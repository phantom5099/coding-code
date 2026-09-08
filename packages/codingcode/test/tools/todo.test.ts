import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { todoWriteTool } from '../../src/tools/domains/self/todo-write.js';
import { TodoLayer } from '../../src/todo/todo.js';

const tool = todoWriteTool;

describe('todo_write tool', () => {
  it('does not expose a deferred flag', () => {
    expect('deferred' in tool).toBe(false);
  });

  it('returns pending/in_progress/completed counts', async () => {
    const result = await Effect.runPromise(
      tool
        .execute(
          {
            plan: [
              { step: 'first', status: 'pending' },
              { step: 'second', status: 'in_progress' },
              { step: 'third', status: 'completed' },
            ],
          },
          { sessionId: 'test-agent' }
        )
        .pipe(Effect.provide(TodoLayer))
    );
    expect(result).toBe('pending=1 in_progress=1 completed=1');
  });

  it('rejects plan exceeding TODO_MAX_ITEMS (20)', async () => {
    const plan = Array.from({ length: 21 }, (_, i) => ({
      step: `step ${i}`,
      status: 'pending' as const,
    }));
    await expect(tool.parameters.parseAsync({ plan })).rejects.toThrow();
  });

  it('rejects step longer than 60 chars', async () => {
    await expect(
      tool.parameters.parseAsync({
        plan: [{ step: 'x'.repeat(61), status: 'pending' }],
      })
    ).rejects.toThrow();
  });

  it('rejects invalid status value', async () => {
    await expect(
      tool.parameters.parseAsync({
        plan: [{ step: 'test', status: 'invalid' }],
      })
    ).rejects.toThrow();
  });

  it('does not accept cancelled status', async () => {
    await expect(
      tool.parameters.parseAsync({
        plan: [{ step: 'test', status: 'cancelled' }],
      })
    ).rejects.toThrow();
  });

  it('fails with AgentError if sessionId is missing', async () => {
    const exit = await Effect.runPromiseExit(
      tool
        .execute({ plan: [{ step: 'x', status: 'pending' }] }, {})
        .pipe(Effect.provide(TodoLayer))
    );
    expect(exit._tag).toBe('Failure');
  });
});
