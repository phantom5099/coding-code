import { Effect, ManagedRuntime } from 'effect';
import { AgentError } from '../core/error.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export type Result<A, E> = { ok: true; value: A } | { ok: false; error: E };

export function createRunWithLayer(rt: ManagedRt) {
  return async function runWithLayer<A, E>(eff: Effect.Effect<A, E, any>): Promise<Result<A, E>> {
    return rt.runPromise(
      eff.pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(
            new AgentError('SESSION_IO_ERROR' as any, `Unexpected error: ${String(defect)}`, defect)
          )
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
          onFailure: (e) => ({ ok: false as const, error: e as E }),
        })
      )
    ) as Promise<Result<A, E>>;
  };
}

/** 错误信封的唯一构造点：`{ error: { code, message } }` */
export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function errorResponse(err: unknown) {
  if (err instanceof AgentError) {
    return { status: err.httpStatus(), body: errorBody(err.code, err.message) };
  }
  return {
    status: 500,
    body: errorBody('INTERNAL_ERROR', err instanceof Error ? err.message : 'Internal server error'),
  };
}
