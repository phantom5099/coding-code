import { describe, expect, it } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';

import { createDirectAgentClient } from '../../src/direct/agent-runtime.js';
import { createDirectSessionClient } from '../../src/direct/sessions.js';
import { createDirectModelClient } from '../../src/direct/models.js';
import { createDirectSettingsClient } from '../../src/direct/settings.js';
import type { AppRuntime } from '../../src/layer.js';
import type { LLMClient } from '../../src/llm/client.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { WorkspaceService } from '../../src/core/workspace.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
import { AgentError } from '../../src/core/error.js';

type AssertNotAny<T> = 0 extends 1 & T ? never : T;

type _AppRuntimeNotAny = AssertNotAny<AppRuntime>;
type _LLMClientNotAny = AssertNotAny<LLMClient>;

type _AgentParams = Parameters<typeof createDirectAgentClient>;
type _LlmParamNotAny = AssertNotAny<_AgentParams[0]>;
type _RtParamNotAny = AssertNotAny<_AgentParams[1]>;

type _SessionParams = Parameters<typeof createDirectSessionClient>;
type _SessionRtNotAny = AssertNotAny<_SessionParams[0]>;

const MockWorkspaceLayer = Layer.succeed(WorkspaceService, {
  getWorkspaceCwd: () => '/tmp/test',
} as any);

const MockLLMFactoryLayer = Layer.succeed(LLMFactoryService, {
  getLLMClient: () => Effect.succeed(null),
  listModels: () => Effect.succeed([]),
  switchModel: () => Effect.fail(new AgentError('CONFIG_INVALID', 'not found')),
  findModel: () => Effect.succeed(null),
  getActiveEntry: () => Effect.fail(new AgentError('CONFIG_INVALID', 'No active model')),
  createClient: () => Effect.succeed(null),
} as any);

const TestLayer = Layer.mergeAll(
  ApprovalWaitService.Default,
  MockWorkspaceLayer,
  MockLLMFactoryLayer
);

const rt = ManagedRuntime.make(TestLayer);

const noopLlm: LLMClient = {
  completeStream: () => ({
    stream: (async function* () {})(),
    response: Promise.resolve({ ok: true, value: { content: '', finishReason: 'stop' as const } }),
  }),
  complete: () => Effect.succeed({ content: '' } as any),
  modelInfo: { id: 'test', provider: 'test', name: 'Test', contextWindow: 128000 } as any,
};

describe('type replacements: AppRuntime and LLMClient', () => {
  it('createDirectAgentClient accepts LLMClient and ManagedRuntime', () => {
    const agentClient = createDirectAgentClient(noopLlm, rt);
    expect(agentClient).toBeDefined();
    expect(typeof agentClient.sendMessage).toBe('function');
  });

  it('createDirectSessionClient accepts ManagedRuntime', () => {
    const sessionClient = createDirectSessionClient(rt);
    expect(sessionClient).toBeDefined();
    expect(typeof sessionClient.listSessions).toBe('function');
  });

  it('createDirectModelClient accepts ManagedRuntime', () => {
    const modelClient = createDirectModelClient(rt);
    expect(modelClient).toBeDefined();
    expect(typeof modelClient.listModels).toBe('function');
  });

  it('createDirectSettingsClient accepts ManagedRuntime', () => {
    const settingsClient = createDirectSettingsClient(rt);
    expect(settingsClient).toBeDefined();
    expect(typeof settingsClient.getMemoryEnabled).toBe('function');
  });

  it('waitService from runtime has registerEmitter and unregisterEmitter', async () => {
    const waitService = await rt.runPromise(
      Effect.gen(function* () {
        return yield* ApprovalWaitService;
      })
    );
    expect(typeof waitService.registerEmitter).toBe('function');
    expect(typeof waitService.unregisterEmitter).toBe('function');
  });
});
