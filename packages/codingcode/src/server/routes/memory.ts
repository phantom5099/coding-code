import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { MemoryService } from '../../memory/port.js';
import { getMemoryConfig } from '../../memory/config.js';
import { updateMemoryModel } from '../../infra/config.js';
import { json, readJson, type Handler, type Router } from '../handler.js';

const readConfig: Handler = Effect.sync(() => {
  const cfg = getMemoryConfig();
  return json({ enabled: cfg.enabled, model: cfg.model });
});

const setEnabled: Handler = Effect.gen(function* () {
  const body = yield* readJson<{ enabled: boolean }>();
  const memory = yield* MemoryService;
  yield* memory.setMemoryEnabled(body.enabled);
  const enabled = yield* memory.getMemoryEnabled();
  return json({ enabled });
});

const setModel: Handler = Effect.gen(function* () {
  const body = yield* readJson<{ model: string }>();
  updateMemoryModel(body.model);
  return json({ model: body.model });
});

export const addMemorySettingsRoutes = (router: Router): Router =>
  router.pipe(
    HttpRouter.get('/api/settings/memory/config', readConfig),
    HttpRouter.post('/api/settings/memory/enabled', setEnabled),
    HttpRouter.post('/api/settings/memory/model', setModel)
  );
