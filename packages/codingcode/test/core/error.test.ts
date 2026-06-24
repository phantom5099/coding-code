import { describe, it, expect } from 'vitest';
import { AgentError, ApiError } from '../../src/core/error.js';

describe('AgentError.httpStatus', () => {
  it('returns 400 for CONFIG_MISSING', () => {
    const err = AgentError.configMissing('missing');
    expect(err.httpStatus()).toBe(400);
  });

  it('returns 400 for CONFIG_INVALID', () => {
    const err = new AgentError('CONFIG_INVALID', 'invalid');
    expect(err.httpStatus()).toBe(400);
  });

  it('returns 404 for SESSION_NOT_FOUND', () => {
    const err = AgentError.sessionNotFound('abc');
    expect(err.httpStatus()).toBe(404);
  });

  it('returns 409 for SESSION_WORKSPACE_MISMATCH', () => {
    const err = AgentError.sessionWorkspaceMismatch('abc', '/foo');
    expect(err.httpStatus()).toBe(409);
  });

  it('returns 403 for TOOL_NOT_ALLOWED', () => {
    const err = AgentError.toolNotAllowed('write_file');
    expect(err.httpStatus()).toBe(403);
  });

  it('returns 429 for LLM_RATE_LIMITED', () => {
    const err = new AgentError('LLM_RATE_LIMITED', 'rate limited');
    expect(err.httpStatus()).toBe(429);
  });

  it('returns 500 for unknown codes', () => {
    const err = new AgentError('LLM_TIMEOUT', 'timeout');
    expect(err.httpStatus()).toBe(500);
  });
});

describe('ApiError', () => {
  it('formats message from body.message when provided', () => {
    const err = new ApiError(404, '/api/agent/permission-mode', {
      code: 'NOT_FOUND',
      message: 'gone',
    });
    expect(err.message).toBe('gone');
    expect(err.status).toBe(404);
    expect(err.path).toBe('/api/agent/permission-mode');
    expect(err.body?.code).toBe('NOT_FOUND');
    expect(err.name).toBe('ApiError');
  });

  it('falls back to "HTTP <status>: <path>" when body missing', () => {
    const err = new ApiError(500, '/x');
    expect(err.message).toBe('HTTP 500: /x');
    expect(err.body).toBeUndefined();
  });
});
