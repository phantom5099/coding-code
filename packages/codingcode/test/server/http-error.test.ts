import { describe, it, expect } from 'vitest';
import { AgentError, type ErrorCode } from '../../src/core/error.js';
import {
  AlreadyExistsError,
  InvalidInputError,
  NotFoundError,
  errorCodeOf,
  errorResponse,
  statusOf,
} from '../../src/server/http-error.js';

describe('领域错误码 → 状态码（server 层唯一映射点）', () => {
  it('CONFIG_* → 400', () => {
    expect(statusOf(AgentError.configMissing('missing'))).toBe(400);
    expect(statusOf(new AgentError('CONFIG_INVALID', 'invalid'))).toBe(400);
  });

  it('SESSION_NOT_FOUND → 404', () => {
    expect(statusOf(AgentError.sessionNotFound('abc'))).toBe(404);
  });

  it('SESSION_WORKSPACE_MISMATCH → 409', () => {
    expect(statusOf(AgentError.sessionWorkspaceMismatch('abc', '/foo'))).toBe(409);
  });

  it('TOOL_NOT_ALLOWED → 403', () => {
    expect(statusOf(AgentError.toolNotAllowed('write_file'))).toBe(403);
  });

  it('LLM_RATE_LIMITED → 429', () => {
    expect(statusOf(new AgentError('LLM_RATE_LIMITED', 'rate limited'))).toBe(429);
  });

  it('其余 code 一律 500', () => {
    expect(statusOf(new AgentError('LLM_TIMEOUT', 'timeout'))).toBe(500);
    expect(statusOf(new AgentError('TOOL_NOT_FOUND', 'nope'))).toBe(500);
  });

  it('表覆盖全部 ErrorCode —— 新增 code 不补表会编译失败', () => {
    const all: readonly ErrorCode[] = [
      'LLM_TIMEOUT',
      'LLM_RATE_LIMITED',
      'LLM_FAILED',
      'CONTEXT_OVERFLOW',
      'TOOL_NOT_FOUND',
      'TOOL_NOT_ALLOWED',
      'TOOL_EXECUTION_FAILED',
      'MAX_STEPS_REACHED',
      'CONFIG_MISSING',
      'CONFIG_INVALID',
      'SESSION_CORRUPTED',
      'SESSION_NOT_FOUND',
      'SESSION_WORKSPACE_MISMATCH',
      'AGENT_ABORTED',
      'AGENT_LOOP_DETECTED',
      'EMPTY_RESPONSE',
      'SESSION_IO_ERROR',
    ];
    for (const code of all) {
      expect(typeof statusOf(new AgentError(code, 'x'))).toBe('number');
    }
  });
});

describe('server 自带的 HttpError', () => {
  it('NotFoundError → 404 / NOT_FOUND', () => {
    const err = new NotFoundError("Hook 'x' not found");
    expect(statusOf(err)).toBe(404);
    expect(errorCodeOf(err)).toBe('NOT_FOUND');
  });

  it('AlreadyExistsError → 409 / ALREADY_EXISTS', () => {
    const err = new AlreadyExistsError("Hook 'x' already exists");
    expect(statusOf(err)).toBe(409);
    expect(errorCodeOf(err)).toBe('ALREADY_EXISTS');
  });

  it('InvalidInputError → 400 / CONFIG_INVALID', () => {
    const err = new InvalidInputError('bad body');
    expect(statusOf(err)).toBe(400);
    expect(errorCodeOf(err)).toBe('CONFIG_INVALID');
  });
});

describe('errorResponse', () => {
  it('AppError 走穷尽映射', () => {
    const { status, body } = errorResponse(AgentError.sessionNotFound('abc'));
    expect(status).toBe(404);
    expect(body.error.code).toBe('SESSION_NOT_FOUND');
    expect(body.error.message).toBe('[SESSION_NOT_FOUND] Session "abc" not found');
  });

  it('未识别的 Error → 500，保留原文', () => {
    const { status, body } = errorResponse(new Error('boom'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('boom');
  });

  it('非 Error 抛出物 → 500，不丢信息', () => {
    const { status, body } = errorResponse({ weird: true });
    expect(status).toBe(500);
    expect(body.error.message).toContain('[object Object]');
  });

  it('字符串抛出物 → 500，带 Unexpected error 前缀', () => {
    const { status, body } = errorResponse('raw string');
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Unexpected error: raw string');
  });

  // 路由没匹配上不是领域错误、也不是缺陷：必须落 404，不能被「非 AppError 一律 500」吞掉
  it('RouteNotFound → 404，而不是 500', () => {
    const { status, body } = errorResponse({ _tag: 'RouteNotFound' });
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
