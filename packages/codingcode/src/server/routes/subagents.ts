import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { SubagentRunRegistryService } from '../../subagent/registry.js';
import { json, pathParams, type Handler, type Router } from '../handler.js';

const stopAll: Handler = Effect.gen(function* () {
  const { id: sessionId } = yield* pathParams;
  const registry = yield* SubagentRunRegistryService;
  const stopped = yield* registry.stopAll(sessionId ?? '');
  return json({ stopped });
});

export const addSubagentsRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.post('/api/sessions/:id/subagents/stop', stopAll));
