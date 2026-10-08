export class AlreadyExistsError extends Error {
  readonly code = 'ALREADY_EXISTS';
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyExistsError';
  }
  httpStatus(): 409 {
    return 409;
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
  httpStatus(): 404 {
    return 404;
  }
}

/** 自带 HTTP 语义的错误：`code` 决定响应体，`httpStatus()` 决定状态码 */
export interface HttpError extends Error {
  readonly code: string;
  httpStatus(): number;
}

export function isHttpError(err: unknown): err is HttpError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; httpStatus?: unknown };
  return typeof e.code === 'string' && typeof e.httpStatus === 'function';
}
