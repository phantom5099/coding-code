import { describe, it, expect } from 'vitest';
import { NotFoundError, AlreadyExistsError, AgentError } from '../../src/core/error.js';

describe('NotFoundError has code+httpStatus', () => {
  it('code is NOT_FOUND and httpStatus returns 404', () => {
    const err = new NotFoundError('missing');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.httpStatus()).toBe(404);
  });
});

describe('AlreadyExistsError has code+httpStatus', () => {
  it('code is ALREADY_EXISTS and httpStatus returns 409', () => {
    const err = new AlreadyExistsError('exists');
    expect(err.code).toBe('ALREADY_EXISTS');
    expect(err.httpStatus()).toBe(409);
  });
});

describe('AgentError unchanged', () => {
  it('sessionNotFound still returns SESSION_NOT_FOUND with 404', () => {
    const err = AgentError.sessionNotFound('abc');
    expect(err.code).toBe('SESSION_NOT_FOUND');
    expect(err.httpStatus()).toBe(404);
  });
});
