import { expect, it, describe, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { createDispatchAgentTool } from '../../src/tools/domains/subagent/dispatch.js';
import { SessionService } from '../../src/session/store.js';
import { ApprovalService } from '../../src/approval/index.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
import { RulesService } from '../../src/rules/index.js';
import { SubagentService, EXPLORE_PROFILE, BUILD_PROFILE } from '../../src/subagent/registry.js';
import { SubagentRunnerService } from '../../src/subagent/runner-service.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import type { ToolDefinition, ToolExecCtx } from '../../src/tools/types.js';
import type { AgentEvent } from '../../src/agent/types.js';
import type { LLMClient } from '../../src/llm/client.js';

const mockLlm: Partial<LLMClient> = {
  modelInfo: { model: 'test-model', provider: 'test', maxTokens: 8192, displayName: 'test' },
};

function makeMockSession(parentPermissionMode: 'default' | 'bypass' | 'acceptEdits' = 'default') {
  const createImpl = (
    _cwd: string,
    options: { model: string; mode: 'plan' | 'build'; permissionMode: any }
  ) =>
    Effect.succeed({
      sessionId: 'child-1',
      cwd: '/test',
      projectPath: '/test',
      transcriptPath: '/tmp/child.jsonl',
      indexPath: '/tmp/child.index.json',
      messageCount: 0,
      currentTurnId: 0,
      sessionMeta: null,
      model: options.model,
      mode: options.mode,
      permissionMode: options.permissionMode,
      title: 'child',
      usage: undefined,
      memorySnapshot: '',
    });
  return {
    create: createImpl,
    createSessionWithProfile: createImpl,
    load: (_cwd: string, _sid: string) =>
      Effect.succeed({
        sessionId: 'parent-1',
        cwd: '/test',
        projectPath: '/test',
        transcriptPath: '/tmp/parent.jsonl',
        indexPath: '/tmp/parent.index.json',
        messageCount: 0,
        currentTurnId: 0,
        sessionMeta: null,
        model: 'parent-model',
        mode: 'build' as const,
        permissionMode: parentPermissionMode,
        title: 'parent',
        usage: undefined,
        memorySnapshot: '',
      }),
    incrementTurn: () => 0,
    recordUser: () => Effect.succeed({ type: 'user', content: '', turnId: 0 } as any),
    setActiveProfile: () => Effect.void,
    setModeOnDisk: () => Effect.void,
    setPermissionModeOnDisk: () => Effect.void,
  };
}

const mockApproval = {
  evaluate: () => Effect.succeed({ type: 'allow' as const, source: 'system' }),
  addRule: () => Effect.void,
  removeRule: () => Effect.void,
  setPermissionMode: () => Effect.void,
  getPermissionMode: () => 'default' as any,
  fork: (opts?: { permissionMode?: any; readonly?: boolean }) =>
    Effect.succeed(mockApproval as any),
};

const mockHooks = {
  register: () => Effect.succeed(() => {}),
  registerDecision: () => Effect.succeed(() => {}),
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
  attachSessionHooks: () => Effect.succeed(undefined),
  disableHook: () => Effect.succeed(undefined),
  enableHook: () => Effect.succeed(undefined),
  disposeSession: () => Effect.succeed(undefined),
  disposeProject: () => Effect.succeed(undefined),
};

const mockMcp = {
  connectServers: () => Effect.void,
  syncConnections: () => Effect.void,
  listProjectMcpTools: () => [],
  disposeSession: () => Effect.void,
};

const mockLlmFactory = {
  getLLMClient: () => Effect.succeed(mockLlm as LLMClient),
  findModel: () => Effect.succeed(null),
  createClient: () => Effect.succeed(mockLlm as LLMClient),
};

const mockRules = {
  getAllRules: () => '',
  evictProjectRules: () => undefined,
};

const mockSubagent = {
  registerGlobal: () => undefined,
  registerProject: () => undefined,
  get: (_p: string, name: string) => {
    if (name === 'explore') return EXPLORE_PROFILE;
    if (name === 'build') return BUILD_PROFILE;
    if (name === 'custom') return { name: 'custom', description: 'custom agent' } as any;
    return undefined;
  },
  list: () => [EXPLORE_PROFILE, BUILD_PROFILE],
  resetProject: () => undefined,
};

const mockProjectRuntime = {
  prepareProject: () => Effect.void,
  resolveMainAgentProfile: () => undefined,
  resolveSubagentProfile: (_p: string, name: string) => mockSubagent.get(_p, name),
  listAgentProfiles: () => [EXPLORE_PROFILE, BUILD_PROFILE],
  getToolPolicy: () => ({
    allowedTools: undefined,
    allowedMcpServers: undefined,
    allowToolSearch: true,
    allowDeferredTools: false,
  }),
  setSessionProfile: () => Effect.void,
  restoreSessionProfile: () => Effect.void,
  getSessionProfile: () => Effect.succeed(undefined),
  getSessionPermissionMode: () => Effect.succeed('default' as any),
  disposeSession: () => Effect.void,
  disposeProject: () => Effect.void,
};

function makeRunStream(): AsyncGenerator<AgentEvent> {
  return (async function* () {
    yield { _tag: 'Done', content: 'done' } as AgentEvent;
  })();
}

function makeLayers(parentPermissionMode: 'default' | 'bypass' | 'acceptEdits' = 'default') {
  const subagentRunner = { runStream: vi.fn().mockReturnValue(makeRunStream()) };
  return Layer.mergeAll(
    Layer.succeed(
      SessionService,
      SessionService.make(makeMockSession(parentPermissionMode) as any)
    ),
    Layer.succeed(ApprovalService, ApprovalService.make(mockApproval as any)),
    Layer.succeed(HookService, HookService.make(mockHooks as any)),
    Layer.succeed(McpService, McpService.make(mockMcp as any)),
    Layer.succeed(LLMFactoryService, mockLlmFactory as any),
    Layer.succeed(RulesService, mockRules as any),
    Layer.succeed(SubagentService, mockSubagent as any),
    Layer.succeed(ProjectRuntimeService, ProjectRuntimeService.make(mockProjectRuntime as any)),
    Layer.succeed(SubagentRunnerService, subagentRunner as any)
  );
}

async function dispatchTool(
  parentPermissionMode: 'default' | 'bypass' | 'acceptEdits' = 'default',
  agentName: string,
  ctx: ToolExecCtx
) {
  const all = makeLayers(parentPermissionMode);
  const capturePerm: any = { value: undefined };
  const localApproval = {
    ...mockApproval,
    fork: vi.fn((opts: any) => {
      capturePerm.value = opts?.permissionMode;
      return Effect.succeed(mockApproval as any);
    }),
  };
  const allWithCapture = Layer.mergeAll(
    Layer.succeed(
      SessionService,
      SessionService.make(makeMockSession(parentPermissionMode) as any)
    ),
    Layer.succeed(ApprovalService, ApprovalService.make(localApproval as any)),
    Layer.succeed(HookService, HookService.make(mockHooks as any)),
    Layer.succeed(McpService, McpService.make(mockMcp as any)),
    Layer.succeed(LLMFactoryService, mockLlmFactory as any),
    Layer.succeed(RulesService, mockRules as any),
    Layer.succeed(SubagentService, mockSubagent as any),
    Layer.succeed(ProjectRuntimeService, ProjectRuntimeService.make(mockProjectRuntime as any)),
    Layer.succeed(SubagentRunnerService, {
      runStream: vi.fn().mockReturnValue(makeRunStream()),
    } as any)
  );
  const tool = (await Effect.runPromise(
    createDispatchAgentTool().pipe(Effect.provide(allWithCapture) as any)
  )) as ToolDefinition;
  await Effect.runPromise(tool.execute({ agent: agentName, prompt: 'go' }, ctx) as any);
  return capturePerm.value;
}

describe('dispatch_agent permission-mode priority (profile > parent > default)', () => {
  it('case 1: profile has explicit permissionMode → child uses profile value', async () => {
    const perm = await dispatchTool('default', 'explore', {
      projectPath: '/test',
      sessionId: 'parent-1',
    } as ToolExecCtx);
    expect(perm).toBe('bypass');
  });

  it('case 2: profile has no permissionMode + parent has bypass → child uses parent value', async () => {
    const perm = await dispatchTool('bypass', 'custom', {
      projectPath: '/test',
      sessionId: 'parent-1',
    } as ToolExecCtx);
    expect(perm).toBe('bypass');
  });

  it('case 3: profile has no permissionMode + no parent (top-level) → child uses default', async () => {
    const perm = await dispatchTool('default', 'custom', {
      projectPath: '/test',
    } as ToolExecCtx);
    expect(perm).toBe('default');
  });
});
