import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { TurnRegistryService } from '../../turn/port.js';
import { json, pathParams, type Handler, type Router } from '../handler.js';

const stopAll: Handler = Effect.gen(function* () {
  const { id: sessionId } = yield* pathParams;
  const turn = yield* TurnRegistryService;
  const stopped = yield* turn.stopChildren(sessionId ?? '');
  return json({ stopped });
});

export const addSubagentsRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.post('/api/sessions/:id/subagents/stop', stopAll));
