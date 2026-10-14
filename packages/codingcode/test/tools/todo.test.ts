import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { todoWriteTool } from '../../src/tools/domains/self/todo-write.js';
import { todoReadTool } from '../../src/tools/domains/self/todo-read.js';
import { TodoLayer } from '../../src/todo/todo.js';
import type { TodoItem } from '../../src/todo/types.js';

const tool = todoWriteTool;

describe('todo_write tool', () => {
  it('does not expose a deferred flag', () => {
    expect('deferred' in tool).toBe(false);
  });

  it('returns the full formatted todo list as ground truth', async () => {
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
          { sessionId: 'test-agent', model: 'test-model' }
        )
        .pipe(Effect.provide(TodoLayer))
    );
    expect(result).toBe(
      'Current todo list (3 items):\n1. [pending] first\n2. [in_progress] second\n3. [completed] third'
    );
  });

  it('returns a cleared notice for an empty plan', async () => {
    const result = await Effect.runPromise(
      tool
        .execute({ plan: [] }, { sessionId: 'test-agent', model: 'test-model' })
        .pipe(Effect.provide(TodoLayer))
    );
    expect(result).toBe('Todo list cleared (now empty).');
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
        .execute({ plan: [{ step: 'x', status: 'pending' }] }, { model: 'test-model' })
        .pipe(Effect.provide(TodoLayer))
    );
    expect(exit._tag).toBe('Failure');
  });
});

const readTool = todoReadTool;

describe('todo_read tool', () => {
  it('does not expose a deferred flag', () => {
    expect('deferred' in readTool).toBe(false);
  });

  it('is concurrencySafe (pure read)', () => {
    expect(readTool.concurrencySafe).toBe(true);
  });

  it('returns an empty notice for an unknown sessionId', async () => {
    const result = await Effect.runPromise(
      readTool.execute({}, { sessionId: 'test-agent', model: 'test-model' }).pipe(Effect.provide(TodoLayer))
    );
    expect(result).toBe('Todo list is empty.');
  });

  it('returns the full formatted list after todo_write', async () => {
    const plan: TodoItem[] = [
      { step: 'first', status: 'pending' },
      { step: 'second', status: 'in_progress' },
      { step: 'third', status: 'completed' },
    ];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* todoWriteTool.execute({ plan }, { sessionId: 'test-agent', model: 'test-model' });
        return yield* readTool.execute({}, { sessionId: 'test-agent', model: 'test-model' });
      }).pipe(Effect.provide(TodoLayer))
    );
    expect(result).toBe(
      'Current todo list (3 items):\n1. [pending] first\n2. [in_progress] second\n3. [completed] third'
    );
  });

  it('reads only the calling session list (per-session isolation)', async () => {
    const { readA, readB } = await Effect.runPromise(
      Effect.gen(function* () {
        yield* todoWriteTool.execute(
          { plan: [{ step: 'a1', status: 'pending' }] },
          { sessionId: 'agent-a', model: 'test-model' }
        );
        return {
          readA: yield* readTool.execute({}, { sessionId: 'agent-a', model: 'test-model' }),
          readB: yield* readTool.execute({}, { sessionId: 'agent-b', model: 'test-model' }),
        };
      }).pipe(Effect.provide(TodoLayer))
    );
    expect(readA).toBe('Current todo list (1 item):\n1. [pending] a1');
    expect(readB).toBe('Todo list is empty.');
  });

  it('returns an empty notice after the list is cleared', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* todoWriteTool.execute(
          { plan: [{ step: 'x', status: 'pending' }] },
          { sessionId: 'test-agent', model: 'test-model' }
        );
        yield* todoWriteTool.execute({ plan: [] }, { sessionId: 'test-agent', model: 'test-model' });
        return yield* readTool.execute({}, { sessionId: 'test-agent', model: 'test-model' });
      }).pipe(Effect.provide(TodoLayer))
    );
    expect(result).toBe('Todo list is empty.');
  });

  it('fails with AgentError if sessionId is missing', async () => {
    const exit = await Effect.runPromiseExit(
      readTool.execute({}, { model: 'test-model' }).pipe(Effect.provide(TodoLayer))
    );
    expect(exit._tag).toBe('Failure');
  });
});
