import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { HookService } from '../../src/hooks/registry.js';

const TestLayer = HookService.Default;

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(TestLayer) as any));
}

describe('HookService 鈥?Decision Handlers', () => {
  it('should return null from emitDecision when no handlers registered', async () => {
    const result = await run(Effect.gen(function* () {
      const hooks = yield* HookService;
      return yield* hooks.emitDecision('tool.approval.pre', {});
    }));
    expect(result).toBeNull();
  });

  it('should return first non-null decision from registered handlers', async () => {
    const result = await run(Effect.gen(function* () {
      const hooks = yield* HookService;

      yield* hooks.registerDecision('tool.approval.pre', () => null, { priority: 10 });
      yield* hooks.registerDecision('tool.approval.pre', () => ({ decision: 'deny' as const, reason: 'Second handler' }), { priority: 20 });
      yield* hooks.registerDecision('tool.approval.pre', () => ({ decision: 'allow' as const }), { priority: 30 });

      return yield* hooks.emitDecision('tool.approval.pre', {});
    }));
    expect(result).toEqual({ decision: 'deny', reason: 'Second handler' });
  });

  it('should prioritize lower priority number (runs first)', async () => {
    const order: number[] = [];
    const result = await run(Effect.gen(function* () {
      const hooks = yield* HookService;

      yield* hooks.registerDecision('tool.approval.pre', () => { order.push(20); return null; }, { priority: 20 });
      yield* hooks.registerDecision('tool.approval.pre', () => { order.push(10); return { decision: 'deny' as const }; }, { priority: 10 });

      const r = yield* hooks.emitDecision('tool.approval.pre', {});
      return { order, r };
    }));
    expect(order).toEqual([10]);  // priority 10 ran first, returned non-null
    expect(result.r).toEqual({ decision: 'deny' });
  });

  it('should separate observer and decision handlers', async () => {
    const calls: string[] = [];
    const result = await run(Effect.gen(function* () {
      const hooks = yield* HookService;

      yield* hooks.register('tool.approval.pre', () => { calls.push('observer'); });
      yield* hooks.registerDecision('tool.approval.pre', () => { calls.push('decision'); return { decision: 'deny' as const }; }, { priority: 5 });

      const r = yield* hooks.emitDecision('tool.approval.pre', {});
      return { calls, r };
    }));
    // emitDecision only runs decision handlers, not observers
    expect(result.calls).toEqual(['decision']);
    expect(result.r).toEqual({ decision: 'deny' });
  });

  it('should unregister decision handler via returned function', async () => {
    const result = await run(Effect.gen(function* () {
      const hooks = yield* HookService;
      const unregister = yield* hooks.registerDecision('tool.approval.pre', () => ({ decision: 'deny' as const }));
      yield* Effect.sync(() => unregister());
      return yield* hooks.emitDecision('tool.approval.pre', {});
    }));
    expect(result).toBeNull();
  });

  it('should support allow/ask/deny from decision handler', async () => {
    const result = await run(Effect.gen(function* () {
      const hooks = yield* HookService;

      yield* hooks.registerDecision('tool.approval.pre', () => ({ decision: 'ask' as const }));

      return yield* hooks.emitDecision('tool.approval.pre', {});
    }));
    expect(result).toEqual({ decision: 'ask' });
  });
});
