import { Hono } from 'hono';
import { listModels, switchModel, getActiveEntry } from '../../llm/factory.js';

export const modelsRouter = new Hono();

modelsRouter.get('/', (c) => {
  const modelsResult = listModels();
  const activeResult = getActiveEntry();
  const models = modelsResult.ok ? modelsResult.value : [];
  const activeId = activeResult.ok ? activeResult.value.id : '';
  return c.json({ models, activeId });
});

modelsRouter.post('/switch', async (c) => {
  const { modelId } = await c.req.json() as { modelId: string };
  const result = switchModel(modelId);
  return c.json({ ok: result.ok, error: result.ok ? undefined : result.error.message });
});
