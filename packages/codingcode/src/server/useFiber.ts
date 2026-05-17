import { useEffect } from 'react';
import { Effect, Fiber } from 'effect';

export function useEffectFiber(
  program: Effect.Effect<unknown, unknown>,
  deps: unknown[],
): void {
  useEffect(() => {
    const fiber = Effect.runFork(program);
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, deps);
}
