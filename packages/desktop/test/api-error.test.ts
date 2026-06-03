import { describe, it, expect } from 'vitest';

(globalThis as any).window = { location: { search: '' } };

const { ApiError } = await import('../src/lib/api');

describe('ApiError', () => {
  it('uses body.message as message when available', () => {
    const err = new ApiError(404, '/api/sessions/abc', {
      code: 'SESSION_NOT_FOUND',
      message: 'Not found',
    });
    expect(err.message).toBe('Not found');
    expect(err.status).toBe(404);
  });

  it('falls back to HTTP status string when body is missing', () => {
    const err = new ApiError(500, '/api/test');
    expect(err.message).toBe('HTTP 500: /api/test');
  });

  it('exposes body, status and path', () => {
    const err = new ApiError(409, '/api/agents', { code: 'ALREADY_EXISTS', message: 'exists' });
    expect(err.status).toBe(409);
    expect(err.path).toBe('/api/agents');
    expect(err.body).toEqual({ code: 'ALREADY_EXISTS', message: 'exists' });
  });
});
