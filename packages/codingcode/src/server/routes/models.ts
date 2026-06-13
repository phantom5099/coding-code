import { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { LLMFactoryService } from '../../llm/factory.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function createModelsRouter(rt: ManagedRt): Hono {
  const router = new Hono();

  router.get('/', async (c) => {
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const factory = yield* LLMFactoryService;
        const modelsResult = yield* Effect.either(factory.listModels());
        const activeResult = yield* Effect.either(factory.getActiveEntry());
        return {
          models: modelsResult._tag === 'Right' ? modelsResult.right : [],
          activeId: activeResult._tag === 'Right' ? activeResult.right.id : '',
        };
      })
    );
    return c.json(result);
  });

  router.post('/switch', async (c) => {
    const { modelId } = (await c.req.json()) as { modelId: string };
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const factory = yield* LLMFactoryService;
        return yield* Effect.either(factory.switchModel(modelId));
      })
    );
    return c.json({ ok: result._tag === 'Right', error: result._tag === 'Left' ? result.left.message : undefined });
  });

  return router;
}
