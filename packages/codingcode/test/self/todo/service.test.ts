﻿import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { TodoService, countByStatus } from '../../../src/agent/todo.js';
import type { Todo } from '../../../src/agent/todo.js';

describe('TodoService', () => {
  it('write then read returns full list', async () => {
    const plan: Todo[] = [
      { step: 'step 1', status: 'pending' },
      { step: 'step 2', status: 'in_progress' },
      { step: 'step 3', status: 'completed' },
    ];

    const got = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TodoService;
        svc.write('agent-a', plan);
        return svc.read('agent-a');
      }).pipe(Effect.provide(TodoService.Default))
    );

    expect(got).toEqual(plan);
  });

  it('different sessionIds do not interfere', async () => {
    const { readA, readB } = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TodoService;
        svc.write('agent-a', [{ step: 'a1', status: 'pending' }]);
        svc.write('agent-b', [{ step: 'b1', status: 'completed' }]);
        return {
          readA: svc.read('agent-a'),
          readB: svc.read('agent-b'),
        };
      }).pipe(Effect.provide(TodoService.Default))
    );

    expect(readA).toHaveLength(1);
    expect(readB).toHaveLength(1);
    expect(readA[0]!.step).toBe('a1');
    expect(readB[0]!.step).toBe('b1');
  });

  it('write replaces entirely (not append)', async () => {
    const got = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TodoService;
        svc.write('agent-r', [{ step: 'first', status: 'pending' }]);
        svc.write('agent-r', [{ step: 'second', status: 'completed' }]);
        return svc.read('agent-r');
      }).pipe(Effect.provide(TodoService.Default))
    );

    expect(got).toHaveLength(1);
    expect(got[0]!.step).toBe('second');
  });

  it('read returns empty array for unknown sessionId', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TodoService;
        return svc.read('unknown');
      }).pipe(Effect.provide(TodoService.Default))
    );

    expect(result).toEqual([]);
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

  it('reset clears all sessions', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TodoService;
        svc.write('agent-x', [{ step: 'x', status: 'pending' }]);
        expect(svc.read('agent-x')).toHaveLength(1);

        svc.reset();

        return svc.read('agent-x');
      }).pipe(Effect.provide(TodoService.Default))
    );

    expect(result).toEqual([]);
  });
});
