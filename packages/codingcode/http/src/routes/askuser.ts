import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { AskWaitService, parseAskAnswer } from '@codingcode/askuser';
import { json, pathParams, readJsonOrEmpty, type Handler, type Router } from '../handler.js';

const resolve: Handler = Effect.gen(function* () {
  const { id, sessionId } = yield* pathParams;
  const body = yield* readJsonOrEmpty<{ options?: unknown; custom?: unknown }>();

  const svc = yield* AskWaitService;
  const resolved = yield* svc.resolveAsk({
    callId: id ?? '',
    sessionId: sessionId ?? '',
    answer: parseAskAnswer(body),
  });
  return json({ ok: resolved });
});

export const addAskUserRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.post('/api/sessions/:sessionId/askuser/:id', resolve));
