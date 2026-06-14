﻿import { describe, it, expect } from 'vitest';
import { errorResponse } from '../../src/server/util.js';
import { AgentError } from '../../src/core/error.js';

describe('server/util', () => {
  describe('errorResponse', () => {
    it('returns AgentError status for known codes', () => {
      const err = AgentError.sessionNotFound('abc');
      const resp = errorResponse(err);
      expect(resp.status).toBe(404);
      expect(resp.body.error.code).toBe('SESSION_NOT_FOUND');
      expect(resp.body.error.message).toBe('[SESSION_NOT_FOUND] Session "abc" not found');
    });

    it('returns 500 for unknown errors with original message', () => {
      const resp = errorResponse(new Error('boom'));
      expect(resp.status).toBe(500);
      expect(resp.body.error.code).toBe('INTERNAL_ERROR');
      expect(resp.body.error.message).toBe('boom');
    });

    it('returns 500 with fallback for non-Error throw', () => {
      const resp = errorResponse('raw string');
      expect(resp.status).toBe(500);
      expect(resp.body.error.code).toBe('INTERNAL_ERROR');
      expect(resp.body.error.message).toBe('Internal server error');
    });

    it('returns 400 for CONFIG_MISSING', () => {
      const err = AgentError.configMissing('missing');
      const resp = errorResponse(err);
      expect(resp.status).toBe(400);
      expect(resp.body.error.message).toBe('[CONFIG_MISSING] missing');
    });

    it('returns 403 for TOOL_NOT_ALLOWED', () => {
      const err = AgentError.toolNotAllowed('write_file');
      const resp = errorResponse(err);
      expect(resp.status).toBe(403);
      expect(resp.body.error.message).toBe('[TOOL_NOT_ALLOWED] Tool "write_file" is not allowed');
    });

    it('returns 429 for LLM_RATE_LIMITED', () => {
      const err = new AgentError('LLM_RATE_LIMITED', 'rate limited');
      const resp = errorResponse(err);
      expect(resp.status).toBe(429);
    });
  });
});
