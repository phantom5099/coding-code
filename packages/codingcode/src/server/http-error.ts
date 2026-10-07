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
