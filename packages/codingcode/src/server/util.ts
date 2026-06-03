import { Effect } from 'effect';
import { AgentError } from '../core/error.js';

export type Result<A, E> = { ok: true; value: A } | { ok: false; error: E };

export async function runWithLayer<A, E>(eff: Effect.Effect<A, E, any>): Promise<Result<A, E>> {
  const { AppLayer } = await import('../layer.js');
  return Effect.runPromise(
    eff.pipe(
      Effect.match({
        onSuccess: (a) => ({ ok: true as const, value: a }),
        onFailure: (e) => ({ ok: false as const, error: e }),
      }),
      Effect.provide(AppLayer) as any
    )
  );
}

export function errorResponse(err: unknown) {
  if (err instanceof AgentError) {
    return { status: err.httpStatus(), body: { error: { code: err.code, message: err.message } } };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
  };
}
