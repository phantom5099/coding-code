import type { Hono } from 'hono';
import { Cause, Effect, Exit, ManagedRuntime } from 'effect';
import { isHttpError } from './http-error.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

function toError(u: unknown): Error {
  if (u instanceof Error) return u;
  return new Error(typeof u === 'string' ? u : `Unexpected error: ${String(u)}`);
}


export function createRunWithLayer(rt: ManagedRt) {
  return async function runWithLayer<A, E>(eff: Effect.Effect<A, E, any>): Promise<A> {
    const exit = await rt.runPromiseExit(eff);
    if (Exit.isSuccess(exit)) return exit.value;
    throw toError(Cause.squash(exit.cause));
  };
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

/** 错误值 → HTTP 状态码 + 响应体。**唯一映射点**，只由 `onError` 调用。 */
export function errorResponse(err: unknown): {
  status: number;
  body: { error: { code: string; message: string } };
} {
  if (isHttpError(err)) {
    return { status: err.httpStatus(), body: errorBody(err.code, err.message) };
  }
  return {
    status: 500,
    body: errorBody('INTERNAL_ERROR', err instanceof Error ? err.message : 'Internal server error'),
  };
}

export function registerErrorHandler(app: Hono): void {
  app.onError((err, c) => {
    const { status, body } = errorResponse(err);
    if (status >= 500) console.error(`[${status} ${body.error.code}]`, err);
    return c.json(body, status as any);
  });
}
