import { describe, it, expect } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createRunWithLayer, errorResponse } from '../../src/server/util.js';
import { AlreadyExistsError, NotFoundError } from '../../src/server/http-error.js';
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

    it('returns 404 for NotFoundError（自带 code + httpStatus，不必是 AgentError）', () => {
      const resp = errorResponse(new NotFoundError("Automation 'x' not found"));
      expect(resp.status).toBe(404);
      expect(resp.body.error.code).toBe('NOT_FOUND');
      expect(resp.body.error.message).toBe("Automation 'x' not found");
    });

    it('returns 409 for AlreadyExistsError', () => {
      const resp = errorResponse(new AlreadyExistsError("Hook 'x' already exists"));
      expect(resp.status).toBe(409);
      expect(resp.body.error.code).toBe('ALREADY_EXISTS');
    });
  });

  describe('createRunWithLayer', () => {
    const runWithLayer = createRunWithLayer(ManagedRuntime.make(Layer.empty as any) as any);

    it('返回成功值', async () => {
      await expect(runWithLayer(Effect.succeed(1))).resolves.toBe(1);
    });

    it('正常失败原样抛出（http 语义交给 onError）', async () => {
      await expect(runWithLayer(Effect.fail(new NotFoundError('nope')))).rejects.toBeInstanceOf(
        NotFoundError
      );
    });

    it('把非 Error 的失败归一成 Error —— Hono onError 只接 instanceof Error', async () => {
      await expect(runWithLayer(Effect.fail('boom'))).rejects.toBeInstanceOf(Error);
    });

    it('defect 同样归一成 Error，不逃出边界', async () => {
      await expect(runWithLayer(Effect.die('die'))).rejects.toBeInstanceOf(Error);
    });
  });
});
