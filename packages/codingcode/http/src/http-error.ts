import * as HttpServerResponse from '@effect/platform/HttpServerResponse';
import { Effect, Match } from 'effect';
import { AgentError, type ErrorCode } from '@codingcode/util';
import type { ConfigMutationOutcome } from '@codingcode/infra';

const DOMAIN_STATUS: Record<ErrorCode, number> = {
  LLM_TIMEOUT: 500,
  LLM_RATE_LIMITED: 429,
  LLM_FAILED: 500,
  CONTEXT_OVERFLOW: 500,
  TOOL_NOT_FOUND: 500,
  TOOL_NOT_ALLOWED: 403,
  TOOL_EXECUTION_FAILED: 500,
  MAX_STEPS_REACHED: 500,
  CONFIG_MISSING: 400,
  CONFIG_INVALID: 400,
  SESSION_CORRUPTED: 500,
  SESSION_NOT_FOUND: 404,
  SESSION_WORKSPACE_MISMATCH: 409,
  AGENT_ABORTED: 500,
  AGENT_TERMINATED: 500,
  AGENT_LOOP_DETECTED: 500,
  SUBAGENT_FAILED: 500,
  EMPTY_RESPONSE: 500,
  SESSION_IO_ERROR: 500,
  INVALID_INPUT: 400,
  TURN_CONFLICT: 409,
  SANDBOX_UNAVAILABLE: 403,
  SANDBOX_PATH_DENIED: 403,
  SANDBOX_NETWORK_DENIED: 403,
  SANDBOX_POLICY_DENIED: 403,
};

export type HttpErrorCode = ErrorCode | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INTERNAL_ERROR';

export class NotFoundError extends Error {
  readonly _tag = 'NotFoundError';
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class AlreadyExistsError extends Error {
  readonly _tag = 'AlreadyExistsError';
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyExistsError';
  }
}

export type HttpError = NotFoundError | AlreadyExistsError;
export type AppError = HttpError | AgentError;

export const isHttpError = (u: unknown): u is HttpError =>
  u instanceof NotFoundError || u instanceof AlreadyExistsError;

export const isAppError = (u: unknown): u is AppError => isHttpError(u) || u instanceof AgentError;

/** 配置变更结果统一映射到 HTTP 语义错误 */
export function unwrapConfigOutcome(
  outcome: ConfigMutationOutcome,
  labels: { readonly alreadyExists: string; readonly notFound: string }
): Effect.Effect<void, HttpError> {
  if (outcome.ok) return Effect.void;
  return Effect.fail(
    outcome.reason === 'already-exists'
      ? new AlreadyExistsError(labels.alreadyExists)
      : new NotFoundError(labels.notFound)
  );
}

/** 错误 → 响应体里的 code。 */
export const errorCodeOf = Match.type<AppError>().pipe(
  Match.tag('NotFoundError', () => 'NOT_FOUND' as const),
  Match.tag('AlreadyExistsError', () => 'ALREADY_EXISTS' as const),
  Match.tag('AgentError', (e) => e.code),
  Match.exhaustive
);

/** 错误 → HTTP 状态码 */
export const statusOf = Match.type<AppError>().pipe(
  Match.tag('NotFoundError', () => 404),
  Match.tag('AlreadyExistsError', () => 409),
  Match.tag('AgentError', (e) => DOMAIN_STATUS[e.code]),
  Match.exhaustive
);

export interface ErrorPayload {
  readonly status: number;
  readonly body: { readonly error: { readonly code: HttpErrorCode; readonly message: string } };
}

export function errorBody(err: { readonly code: HttpErrorCode; readonly message: string }) {
  return { error: { code: err.code, message: err.message } };
}

export const isRouteNotFound = (u: unknown): boolean =>
  typeof u === 'object' && u !== null && (u as { _tag?: unknown })._tag === 'RouteNotFound';

/** 任意抛出物 → 状态码 + 响应体。非 AppError 一律 500，并保留原文以免丢信息。 */
export function errorResponse(err: unknown): ErrorPayload {
  if (isRouteNotFound(err)) {
    return { status: 404, body: errorBody({ code: 'NOT_FOUND', message: 'Route not found' }) };
  }
  if (isAppError(err)) {
    return {
      status: statusOf(err),
      body: errorBody({ code: errorCodeOf(err), message: err.message }),
    };
  }
  return {
    status: 500,
    body: errorBody({
      code: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : `Unexpected error: ${String(err)}`,
    }),
  };
}

/** platform 侧出口：错误 → HttpServerResponse */
export function toHttpServerResponse(err: unknown): HttpServerResponse.HttpServerResponse {
  const { status, body } = errorResponse(err);
  return HttpServerResponse.unsafeJson(body, { status });
}
