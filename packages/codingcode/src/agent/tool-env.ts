import { Effect, Layer } from 'effect';
import type { Context } from 'effect';
import { ToolEnvPort } from './port.js';
import type { ToolEnv } from './port.js';

export const ToolEnvLayer = Layer.effect(
  ToolEnvPort,
  Effect.succeed({
    getToolEnv: (): Effect.Effect<ToolEnv> =>
      Effect.gen(function* () {

        const ctx = yield* (Effect.context<any>() as Effect.Effect<Context.Context<any>>);
        const env: ToolEnv = {
          provide: <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, never> =>
            Effect.provide(effect, ctx) as Effect.Effect<A, E, never>,
        };
        return env;
      }),
  })
);
