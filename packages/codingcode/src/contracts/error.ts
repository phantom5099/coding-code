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

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body?: { code: string; message: string }
  ) {
    super(body?.message ?? `HTTP ${status}: ${path}`);
    this.name = 'ApiError';
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
