import type { Hono } from 'hono';
import type { ManagedRuntime } from 'effect';
import { activeModelId, listModels } from '../../infra/models.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerModelsRoutes(router: Hono, _rt: ManagedRt): void {
  router.get('/api/models', (c) => {
    return c.json({ models: listModels(), activeId: activeModelId() });
  });
}
