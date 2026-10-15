import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { AskWaitService, type AskAnswer } from '../../askuser/port.js';
import { json, pathParams, readJsonOrEmpty, type Handler, type Router } from '../handler.js';

/** 严格解析回答 body；无法构成有效回答时 fail-closed 为 no_answer */
function parseAskBody(body: { options?: unknown; custom?: unknown }): AskAnswer {
  const custom = typeof body.custom === 'string' ? body.custom : '';
  const raw = Array.isArray(body.options) ? body.options : [];
  const options = raw.filter((item): item is string => typeof item === 'string' && /^[A-D]$/.test(item));
  if (options.length === 0 && custom.trim() === '') return { status: 'no_answer' };
  return { status: 'answered', options, custom: custom.trim() || null };
}

const resolve: Handler = Effect.gen(function* () {
  const { id, sessionId } = yield* pathParams;
  const body = yield* readJsonOrEmpty<{ options?: unknown; custom?: unknown }>();

  const svc = yield* AskWaitService;
  const resolved = yield* svc.resolveAsk(id ?? '', sessionId ?? '', parseAskBody(body));
  return json({ ok: resolved });
});

export const addAskUserRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.post('/api/sessions/:sessionId/askuser/:id', resolve));
