import { describe, expect, it } from 'vitest';
import type {
  AgentRuntimeClient,
  SessionClient,
  ModelClient,
  SettingsClient,
} from '../../src/client/contracts.js';
import { createHttpAgentClient } from '../../src/client/http/agent-runtime.js';
import { createHttpSessionClient } from '../../src/client/http/sessions.js';
import { createHttpModelClient } from '../../src/client/http/models.js';
import { createHttpSettingsClient } from '../../src/client/http/settings.js';
import { createRequestHelpers } from '../../src/client/http/request.js';

type AssertNotAny<T> = 0 extends 1 & T ? never : T;

const request = createRequestHelpers('http://localhost:1');

// 编译期断言：http 实现必须精确满足 contracts 定义的接口
const httpAgent: AgentRuntimeClient = createHttpAgentClient('http://localhost:1', request);
const httpSessions: SessionClient = createHttpSessionClient(request);
const httpModels: ModelClient = createHttpModelClient(request);
const httpSettings: SettingsClient = createHttpSettingsClient(request);

type _HttpAgentNotAny = AssertNotAny<typeof httpAgent>;
type _HttpSessionsNotAny = AssertNotAny<typeof httpSessions>;
type _HttpModelsNotAny = AssertNotAny<typeof httpModels>;
type _HttpSettingsNotAny = AssertNotAny<typeof httpSettings>;

describe('client contracts', () => {
  it('http agent 只暴露 sendMessage / sendApprovalResponse / compact', () => {
    expect(Object.keys(httpAgent).sort()).toEqual([
      'compact',
      'sendApprovalResponse',
      'sendMessage',
    ]);
  });

  it('agent client 不再包含 checkpoint / rollback / fork 死方法', () => {
    const keys = Object.keys(httpAgent);
    for (const dead of [
      'getCheckpointDiff',
      'revertCheckpointFiles',
      'previewRollbackDiff',
      'rollbackCodeToTurn',
      'rollbackContext',
      'rollbackBothToTurn',
      'forkSession',
    ]) {
      expect(keys).not.toContain(dead);
    }
  });

  it('session client 承载全部 checkpoint / rollback / fork 能力', () => {
    const keys = Object.keys(httpSessions);
    for (const required of [
      'getCheckpointDiff',
      'revertCheckpointFiles',
      'previewRollbackDiff',
      'rollbackCodeToTurn',
      'rollbackContext',
      'rollbackBothToTurn',
      'forkSession',
    ]) {
      expect(keys).toContain(required);
    }
  });

  it('model / settings client 形状稳定', () => {
    expect(Object.keys(httpModels).sort()).toEqual(['listModels', 'switchModel']);
    expect(Object.keys(httpSettings)).toContain('getGlobalPermissionMode');
    expect(Object.keys(httpSettings)).toContain('setGlobalPermissionMode');
  });
});
