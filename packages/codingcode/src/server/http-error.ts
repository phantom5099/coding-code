import * as HttpServerResponse from '@effect/platform/HttpServerResponse';
import { Match } from 'effect';
import { AgentError, type ErrorCode } from '../core/error.js';

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
  AGENT_LOOP_DETECTED: 500,
  EMPTY_RESPONSE: 500,
  SESSION_IO_ERROR: 500,
};

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

export class InvalidInputError extends Error {
  readonly _tag = 'InvalidInputError';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

export type HttpError = NotFoundError | AlreadyExistsError | InvalidInputError;
export type AppError = HttpError | AgentError;

export const isHttpError = (u: unknown): u is HttpError =>
  u instanceof NotFoundError || u instanceof AlreadyExistsError || u instanceof InvalidInputError;

export const isAppError = (u: unknown): u is AppError => isHttpError(u) || u instanceof AgentError;

/** 错误 → 响应体里的 code。 */
export const errorCodeOf = Match.type<AppError>().pipe(
  Match.tag('NotFoundError', () => 'NOT_FOUND'),
  Match.tag('AlreadyExistsError', () => 'ALREADY_EXISTS'),
  Match.tag('InvalidInputError', () => 'CONFIG_INVALID'),
  Match.tag('AgentError', (e) => e.code),
  Match.exhaustive
);

/** 错误 → HTTP 状态码 */
export const statusOf = Match.type<AppError>().pipe(
  Match.tag('NotFoundError', () => 404),
  Match.tag('AlreadyExistsError', () => 409),
  Match.tag('InvalidInputError', () => 400),
  Match.tag('AgentError', (e) => DOMAIN_STATUS[e.code]),
  Match.exhaustive
);

export interface ErrorPayload {
  readonly status: number;
  readonly body: { readonly error: { readonly code: string; readonly message: string } };
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const isRouteNotFound = (u: unknown): boolean =>
  typeof u === 'object' && u !== null && (u as { _tag?: unknown })._tag === 'RouteNotFound';

/** 任意抛出物 → 状态码 + 响应体。非 AppError 一律 500，并保留原文以免丢信息。 */
export function errorResponse(err: unknown): ErrorPayload {
  if (isRouteNotFound(err)) {
    return { status: 404, body: errorBody('NOT_FOUND', 'Route not found') };
  }
  if (isAppError(err)) {
    return { status: statusOf(err), body: errorBody(errorCodeOf(err), err.message) };
  }
  return {
    status: 500,
    body: errorBody(
      'INTERNAL_ERROR',
      err instanceof Error ? err.message : `Unexpected error: ${String(err)}`
    ),
  };
}

/** platform 侧出口：错误 → HttpServerResponse */
export function toHttpServerResponse(err: unknown): HttpServerResponse.HttpServerResponse {
  const { status, body } = errorResponse(err);
  return HttpServerResponse.unsafeJson(body, { status });
}
