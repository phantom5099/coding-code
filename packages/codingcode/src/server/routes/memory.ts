import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { MemoryService } from '../../memory/port.js';
import { getMemoryConfig } from '../../memory/config.js';
import { updateMemoryModel } from '../../infra/config.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerMemorySettingsRoutes(router: Hono, rt: ManagedRt): void {
  router.get('/api/settings/memory/config', (c) => {
    const cfg = getMemoryConfig();
    return c.json({
      enabled: cfg.enabled,
      model: cfg.model,
    });
  });

  router.post('/api/settings/memory/enabled', async (c) => {
    const body = (await c.req.json()) as { enabled: boolean };
    await rt.runPromise(
      Effect.gen(function* () {
        const m = yield* MemoryService;
        yield* m.setMemoryEnabled(body.enabled);
      })
    );
    const enabled = await rt.runPromise(
      Effect.gen(function* () {
        const m = yield* MemoryService;
        return yield* m.getMemoryEnabled();
      })
    );
    return c.json({ enabled });
  });

  router.post('/api/settings/memory/model', async (c) => {
    const body = (await c.req.json()) as { model: string };
    updateMemoryModel(body.model);
    return c.json({ model: body.model });
  });
}
