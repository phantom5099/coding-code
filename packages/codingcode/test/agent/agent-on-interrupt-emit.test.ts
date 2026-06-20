import { describe, it, expect } from 'vitest';
import { Effect, Fiber } from 'effect';
import { HookService } from '../../src/hooks/registry.js';

// This file pins the fix to `Effect.onInterrupt` callback in agent.ts
// (around the `agent.turn.end` emit on abort). The old code wrapped the
// emit in `Effect.sync(() => { ... Effect.runPromise(emit) ... })`, which
// runs the emit in a fresh fiber with no service context — so any
// observer that yield*'d a service (HookService, SessionService, …) would
// Die with "Service not found: …". The fix wraps the callback in
// `Effect.gen` and `yield*`s the emit so it runs in the agent's fiber
// (the onInterrupt callback's fiber inherits the agent's services via
// `Effect.provideService` in `AgentService.runStream`).
//
// This test exercises the same `Effect.onInterrupt` + `yield* emit`
// pattern with an observer that yield*'s HookService. Before the fix
// the observer would Die; after the fix it resolves HookService from
// the fiber's context.

describe('Effect.onInterrupt callback can yield* emit (agent.ts abort hook fix)', () => {
  it('observer services resolve from the interrupted fiber context', async () => {
    let observerRan = false;
    let serviceResolved = false;

    const AppLayer = HookService.Default;

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register(
        'agent.turn.end',
        () =>
          Effect.gen(function* () {
            // This yield* is the contract under test. With the old
            // Effect.runPromise path it would Die because the emit ran
            // on a default runtime. With the yield* path it resolves
            // from the agent's fiber context.
            const h = yield* HookService;
            observerRan = true;
            serviceResolved = typeof h.register === 'function';
          }),
        { source: 'system' }
      );
      // Suspend forever so the only way out is via Fiber.interrupt,
      // which triggers Effect.onInterrupt's callback.
      yield* Effect.never;
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          const hooks = yield* HookService;
          yield* hooks.emit('agent.turn.end', { status: 'aborted' }).pipe(Effect.ignore);
        })
      )
    );

    const fiber = Effect.runFork(Effect.provide(program, AppLayer));
    // Yield to the event loop so the registration's Effect.sync
    // completes before we interrupt.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await Effect.runPromise(Fiber.interrupt(fiber));
    // Yield again so the onInterrupt callback's emit (and its observer)
    // get a chance to finish before we assert.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(observerRan).toBe(true);
    expect(serviceResolved).toBe(true);
  });
});
