import { describe, it, expect } from 'vitest';
import { AgentError } from '../../src/core/error.js';

// core 只负责「领域错误码 + 消息」，HTTP 状态码的映射在 server 层（见 test/server/http-error.test.ts）
describe('AgentError', () => {
  it('带上领域码与可判别 tag', () => {
    const err = AgentError.configMissing('missing');
    expect(err.code).toBe('CONFIG_MISSING');
    expect(err._tag).toBe('AgentError');
    expect(err.name).toBe('AgentError');
    expect(err.message).toBe('[CONFIG_MISSING] missing');
  });

  it('工厂方法产出对应领域码', () => {
    expect(AgentError.sessionNotFound('abc').code).toBe('SESSION_NOT_FOUND');
    expect(AgentError.sessionWorkspaceMismatch('abc', '/foo').code).toBe(
      'SESSION_WORKSPACE_MISMATCH'
    );
    expect(AgentError.toolNotAllowed('write_file').code).toBe('TOOL_NOT_ALLOWED');
    expect(AgentError.toolExecutionFailed('read_file', new Error('boom')).code).toBe(
      'TOOL_EXECUTION_FAILED'
    );
    expect(new AgentError('LLM_RATE_LIMITED', 'rate limited').code).toBe('LLM_RATE_LIMITED');
  });
});
