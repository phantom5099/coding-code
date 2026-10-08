import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { activeModelId, listModels } from '../../infra/models.js';
import { json, type Handler, type Router } from '../handler.js';

const list: Handler = Effect.sync(() => json({ models: listModels(), activeId: activeModelId() }));

export const addModelsRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.get('/api/models', list));
