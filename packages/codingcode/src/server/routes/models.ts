import { Hono } from 'hono';
import { Effect } from 'effect';
import { listModels, switchModel, getActiveEntry } from '../../llm/factory.js';

export const modelsRouter = new Hono();

modelsRouter.get('/', (c) => {
  const modelsResult = Effect.runSync(listModels().pipe(Effect.either));
  const activeResult = Effect.runSync(getActiveEntry().pipe(Effect.either));
  const models = modelsResult._tag === 'Right' ? modelsResult.right : [];
  const activeId = activeResult._tag === 'Right' ? activeResult.right.id : '';
  return c.json({ models, activeId });
});

modelsRouter.post('/switch', async (c) => {
  const { modelId } = (await c.req.json()) as { modelId: string };
  const result = Effect.runSync(switchModel(modelId).pipe(Effect.either));
  return c.json({ ok: result._tag === 'Right', error: result._tag === 'Left' ? result.left.message : undefined });
});
