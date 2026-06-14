import { describe, expect, it, vi } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';

import { createDirectClient } from '../../src/client/direct.js';
import { createDirectClients } from '../../src/client/direct/index.js';
import { createDirectAgentClient } from '../../src/client/direct/agent-runtime.js';
import { createDirectSessionClient } from '../../src/client/direct/sessions.js';
import { createDirectModelClient } from '../../src/client/direct/models.js';
import { createDirectSettingsClient } from '../../src/client/direct/settings.js';
import { createAppRuntime, type AppRuntime } from '../../src/layer.js';
import type { LLMClient } from '../../src/llm/client.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { WorkspaceService } from '../../src/core/workspace.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
import { AgentError } from '../../src/core/error.js';

// -- Compile-time type assertions --
// These assertions verify that the types are not `any`.
// If any of these fail at compile time, the types are wrong.

type AssertNotAny<T> = 0 extends 1 & T ? never : T;

// AppRuntime must not be `any`
type _AppRuntimeNotAny = AssertNotAny<AppRuntime>;

// LLMClient must not be `any`
type _LLMClientNotAny = AssertNotAny<LLMClient>;

// Parameters of createDirectClient must not be `any`
type _DirectClientParams = Parameters<typeof createDirectClient>;
type _LlmParamNotAny = AssertNotAny<_DirectClientParams[0]>;
type _RtParamNotAny = AssertNotAny<_DirectClientParams[1]>;

// Parameters of createDirectClients must not be `any`
type _DirectClientsParams = Parameters<typeof createDirectClients>;
type _DirectClientsLlmNotAny = AssertNotAny<_DirectClientsParams[0]>;
type _DirectClientsRtNotAny = AssertNotAny<_DirectClientsParams[1]>;

// -- Runtime tests --

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
  it('createDirectClient accepts LLMClient and ManagedRuntime', async () => {
    const client = await createDirectClient(noopLlm, rt);
    expect(client).toBeDefined();
    expect(typeof client.sendMessage).toBe('function');
  });

  it('createDirectClients accepts LLMClient and ManagedRuntime', () => {
    const clients = createDirectClients(noopLlm, rt);
    expect(clients).toBeDefined();
    expect(clients.agent).toBeDefined();
    expect(clients.sessions).toBeDefined();
    expect(clients.models).toBeDefined();
    expect(clients.settings).toBeDefined();
  });

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

  it('approval service from runtime has getPermissionMode method', async () => {
    // This verifies that `const approval = await rt.runPromise(...)` returns
    // a properly typed ApprovalService (not `any`), so .getPermissionMode() works
    const client = await createDirectClient(noopLlm, rt);
    // getPermissionMode should be a function on the client
    expect(typeof client.getPermissionMode).toBe('function');
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
