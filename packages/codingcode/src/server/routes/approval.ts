import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { ApprovalWaitService } from '../../approval/wait-port.js';
import { parseApprovalResponse } from '../../approval/confirmation.js';
import { json, pathParams, readJsonOrEmpty, type Handler, type Router } from '../handler.js';

const resolve: Handler = Effect.gen(function* () {
  const { id, sessionId } = yield* pathParams;
  const body = yield* readJsonOrEmpty<{ response?: string }>();
  const response = typeof body.response === 'string' ? body.response : '';

  const svc = yield* ApprovalWaitService;
  const resolved = yield* svc.resolveConfirm(id ?? '', sessionId ?? '', parseApprovalResponse(response));
  return json({ ok: resolved });
});

export const addApprovalRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.post('/api/sessions/:sessionId/approval/:id', resolve));
