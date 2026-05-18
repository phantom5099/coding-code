import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { HookService } from './registry.js';
import { AppLayer } from '../layer.js';

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

describe('HookService', () => {
  it('should register and emit a hook', async () => {
    const handler = vi.fn();

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register('tool.execute.before', handler);
      yield* hooks.emit('tool.execute.before', { key: 'val' });
      return handler.mock.calls.length;
    });

    const count = await runWithLayer(program);
    expect(count).toBe(1);
    expect(handler).toHaveBeenCalledWith({ key: 'val' });
  });

  it('should not throw on emit with no handlers', async () => {
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.emit('tool.execute.after', {});
      return true;
    });

    const result = await runWithLayer(program);
    expect(result).toBe(true);
  });

  it('should return unregister function', async () => {
    const handler = vi.fn();

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      const unregister = yield* hooks.register('llm.request.before', handler);
      unregister(); // remove handler
      yield* hooks.emit('llm.request.before', {});
      return handler.mock.calls.length;
    });

    const count = await runWithLayer(program);
    expect(count).toBe(0);
  });

  it('should call multiple handlers for same hook point', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register('session.save.after', h1);
      yield* hooks.register('session.save.after', h2);
      yield* hooks.emit('session.save.after', {});
    });

    await runWithLayer(program);
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('should support async handlers', async () => {
    const results: string[] = [];
    const handler = async () => {
      await new Promise((r) => setTimeout(r, 5));
      results.push('done');
    };

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register('tool.execute.after', handler);
      yield* hooks.emit('tool.execute.after', {});
    });

    await runWithLayer(program);
    expect(results).toEqual(['done']);
  });
});
