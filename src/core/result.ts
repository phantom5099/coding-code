import { AgentError } from './error';

export type Result<T, E = AgentError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Result = {
  ok: <T>(value: T): Result<T, never> => ({ ok: true, value }),
  err: <E>(error: E): Result<never, E> => ({ ok: false, error }),

  map: <T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> =>
    r.ok ? Result.ok(fn(r.value)) : r,

  flatMap: <T, U, E>(r: Result<T, E>, fn: (v: T) => Result<U, E>): Result<U, E> =>
    r.ok ? fn(r.value) : r,

  promise: async <T>(fn: () => Promise<T>, onError: (e: unknown) => AgentError): Promise<Result<T, AgentError>> => {
    try {
      return Result.ok(await fn());
    } catch (e) {
      return Result.err(onError(e));
    }
  },
};
