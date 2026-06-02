import { describe, it, expect } from 'vitest';
import { AgentError } from '../../src/core/error.js';

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
