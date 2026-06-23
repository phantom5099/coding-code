import { expect, it, describe, vi, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { createDispatchAgentTool } from '../../src/tools/domains/subagent/dispatch.js';
import { SessionService } from '../../src/session/store.js';
import { ApprovalService } from '../../src/approval/index.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
import { RulesService } from '../../src/rules/index.js';
import { SubagentService } from '../../src/subagent/registry.js';
import { SubagentRunnerService } from '../../src/subagent/runner-service.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { EXPLORE_PROFILE } from '../../src/subagent/registry.js';
import type { ToolDefinition } from '../../src/tools/types.js';

const mockMcp = {
  connectServers: (_p: string, _s: string, _n: string[]) => Effect.void,
  disconnectServers: (_p: string, _s: string, _n: string[]) => Effect.void,
  getServerToolNames: (_p: string, _n: string) => [] as string[],
  syncConnections: (_p: string) => Effect.void,
  status: (_p: string) => Effect.succeed([]),
  disable: (_p: string, _n: string) => Effect.void,
  enable: (_p: string, _n: string) => Effect.void,
  listProjectMcpTools: (_p: string) => [],
  disposeSession: (_s: string) => Effect.void,
  disposeProject: (_p: string) => Effect.void,
};

const mockHooks = {
  register: () => Effect.succeed(() => {}),
  registerDecision: () => Effect.succeed(() => {}),
  emit: (_p: string, _pl: any) => Effect.void,
  emitDecision: (_p: string, _pl: any) => Effect.succeed(null),
  reloadUserHooks: (_p: string) => Effect.void,
  attachSessionHooks: (_s: string, _h: any[]) => Effect.void,
  disableHook: (_p: string, _n: string) => Effect.void,
  enableHook: (_p: string, _n: string) => Effect.void,
  disposeSession: (_s: string) => Effect.void,
  disposeProject: (_p: string) => Effect.void,
};

const mockApproval = {
  evaluate: () => Effect.succeed({ type: 'allow' as const }),
  addRule: () => Effect.void,
  removeRule: () => Effect.void,
  setPermissionMode: () => Effect.void,
  getPermissionMode: () => 'default' as const,
  fork: (_opts?: any) => Effect.succeed(mockApproval),
};

const mockSession = {
  create: (_cwd: string, _model: string, _sid?: string, _opts?: any) =>
    Effect.succeed({
      sessionId: 'child-123',
      cwd: '/test',
      projectPath: 'test',
      transcriptPath: '/tmp/test.jsonl',
      indexPath: '/tmp/test.index.json',
      messageCount: 0,
      currentTurnId: 0,
      sessionMeta: null,

      title: 'child',
      usage: undefined,
      memorySnapshot: '',
    }),
  incrementTurn: () => 0,
  recordUser: () => Effect.succeed({ type: 'user', content: '', turnId: 0 }),
  recordAssistant: () =>
    Effect.succeed({
      type: 'assistant',
      content: '',
      toolCalls: [],
      turnId: 0,
    }),
  recordToolResult: () =>
    Effect.succeed({
      type: 'tool_result',
      toolName: 'test',
      toolCallId: 'tc1',
      output: '',
      turnId: 0,
    }),
  rollbackToTurn: () =>
    Effect.succeed({
      type: 'rollback',
      throughTurnId: 0,
      reason: '',
    }),
  forkSession: () => Effect.succeed('forked-session-id'),
  renameSession: () => Effect.succeed(undefined),
  readHistory: () => Effect.succeed([]),
  readMessages: () => Effect.succeed([]),
  listSessions: () => Effect.succeed([]),
  getSessionId: () => 'test-session',
  getMessageCount: () => 0,
  setPermissionMode: () => Effect.void,
  getPermissionMode: () => Effect.succeed('default'),
};

const mockModelEntry = {
  id: 'fast-model@API_KEY_B',
  provider: 'provider-b',
  driver: 'openai',
  name: 'Fast Model',
  model: 'fast-model',
  base_url: 'https://api.b.com',
  api_key_env: 'API_KEY_B',
};
const mockSubagentLlm = { _tag: 'subagent-llm', modelInfo: { model: 'subagent-model' } };
const mockDefaultLlm = { _tag: 'default-llm', modelInfo: { model: 'default-model' } };

const mockLLMFactory = {
  listModels: vi.fn(() => Effect.succeed([])),
  findModel: vi.fn((target: string) => {
    if (target === 'fast-model@API_KEY_B') {
      return Effect.succeed(mockModelEntry);
    }
    return Effect.succeed(null);
  }),
  getActiveEntry: vi.fn(() => Effect.succeed(mockModelEntry)),
  switchModel: vi.fn(() => Effect.succeed(mockModelEntry)),
  createClient: vi.fn(() => Effect.succeed(mockSubagentLlm)),
  getLLMClient: vi.fn(() => Effect.succeed(mockDefaultLlm)),
};

const mockRulesService = {
  getAllRules: vi.fn(() => ''),
  evictProjectRules: vi.fn(),
};

const mockSubagentService = {
  registerGlobal: vi.fn(),
  registerProject: vi.fn(),
  get: vi.fn((_projectPath: string, name: string) => {
    if (name === 'explore') return EXPLORE_PROFILE;
    if (name === 'custom-model-agent')
      return { name: 'custom-model-agent', description: 'test', model: 'fast-model@API_KEY_B' };
    if (name === 'bad-model-agent')
      return { name: 'bad-model-agent', description: 'test', model: 'nonexistent-model' };
    return undefined;
  }),
  list: vi.fn((_projectPath: string) => [EXPLORE_PROFILE]),
  resetProject: vi.fn(),
};

const mockProjectRuntime = {
  prepareProject: vi.fn(() => Effect.void),
  resolveMainAgentProfile: vi.fn(),
  resolveSubagentProfile: vi.fn((_projectPath: string, name: string) => {
    return mockSubagentService.get(_projectPath, name);
  }),
  listAgentProfiles: vi.fn(() => [EXPLORE_PROFILE]),
  getToolPolicy: vi.fn(() => ({
    allowedTools: undefined,
    allowedMcpServers: undefined,
    allowToolSearch: true,
    allowDeferredTools: false,
  })),
  setSessionProfile: vi.fn(() => Effect.void),
  restoreSessionProfile: vi.fn(() => Effect.void),
  getSessionProfile: vi.fn(),
  disposeSession: vi.fn(() => Effect.void),
  disposeProject: vi.fn(() => Effect.void),
};

const defaultRunStream = async function* () {
  yield { _tag: 'Done' as const, content: 'done' };
};

const mockSubagentRunner = {
  runStream: vi.fn(defaultRunStream),
};

const MockSessionLayer = Layer.succeed(SessionService, SessionService.make(mockSession as any));
const MockApprovalLayer = Layer.succeed(ApprovalService, ApprovalService.make(mockApproval as any));
const MockHooksLayer = Layer.succeed(HookService, HookService.make(mockHooks as any));
const MockMcpLayer = Layer.succeed(McpService, McpService.make(mockMcp as any));
const MockLLMFactoryLayer = Layer.succeed(LLMFactoryService, mockLLMFactory as any);
const MockRulesLayer = Layer.succeed(RulesService, mockRulesService as any);
const MockSubagentLayer = Layer.succeed(SubagentService, mockSubagentService as any);
const MockProjectRuntimeLayer = Layer.succeed(ProjectRuntimeService, mockProjectRuntime as any);
const MockSubagentRunnerLayer = Layer.succeed(SubagentRunnerService, mockSubagentRunner as any);

const MockLayer = Layer.mergeAll(
  MockSessionLayer,
  MockApprovalLayer,
  MockHooksLayer,
  MockMcpLayer,
  MockLLMFactoryLayer,
  MockRulesLayer,
  MockSubagentLayer,
  MockProjectRuntimeLayer,
  MockSubagentRunnerLayer
);

async function makeTool(): Promise<ToolDefinition> {
  const result = await Effect.runPromise(
    (createDispatchAgentTool() as any).pipe(Effect.provide(MockLayer as any))
  );
  return result as ToolDefinition;
}

function makeMockLayer(overrides: Record<string, any> = {}) {
  const layers: Layer.Layer<any, any, any>[] = [
    overrides.session ?? MockSessionLayer,
    overrides.approval ?? MockApprovalLayer,
    overrides.hooks ?? MockHooksLayer,
    overrides.mcp ?? MockMcpLayer,
    overrides.llmFactory ?? MockLLMFactoryLayer,
    overrides.rules ?? MockRulesLayer,
    overrides.subagent ?? MockSubagentLayer,
    overrides.runtime ?? MockProjectRuntimeLayer,
    overrides.runner ?? MockSubagentRunnerLayer,
  ];
  return (Layer.mergeAll as any)(...layers);
}

describe('dispatch_agent tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubagentRunner.runStream.mockImplementation(defaultRunStream);
    mockLLMFactory.getLLMClient.mockReturnValue(Effect.succeed(mockDefaultLlm));
  });

  it('should create dispatch tool with description mentioning profiles', async () => {
    const tool = await makeTool();
    expect(tool.name).toBe('dispatch_agent');
    expect(tool.description).toContain('Spawn');
    expect(tool.description).toContain('subagent');
  });

  it('should be a core tool (not deferred)', async () => {
    const tool = await makeTool();
    expect(tool.deferred).toBeUndefined();
  });

  it('should validate agent profile exists', async () => {
    const tool = await makeTool();
    try {
      await Effect.runPromise(
        tool.execute({ agent: 'nonexistent', prompt: 'do something' }, { projectPath: '/test' })
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Unknown subagent');
    }
  });

  it('should use SubagentRunnerService.runStream to run the subagent', async () => {
    const tool = await makeTool();
    await Effect.runPromise(
      tool.execute(
        { agent: 'explore', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1' }
      )
    );
    expect(mockSubagentRunner.runStream).toHaveBeenCalled();
  });

  it('should emit spawn.before hook', async () => {
    const emitDecisionFn = vi.fn().mockReturnValue(Effect.succeed(null));
    const customHooks = { ...mockHooks, emitDecision: emitDecisionFn };
    const customHooksLayer = Layer.succeed(HookService, HookService.make(customHooks as any));
    const customLayer = makeMockLayer({ hooks: customHooksLayer });

    const tool = (await Effect.runPromise(
      (createDispatchAgentTool() as any).pipe(Effect.provide(customLayer as any))
    )) as ToolDefinition;
    await Effect.runPromise(
      tool.execute(
        { agent: 'explore', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1' }
      )
    );
    expect(emitDecisionFn).toHaveBeenCalledWith(
      'agent.subagent.spawn.before',
      expect.objectContaining({ profile: 'explore' })
    );
  });

  it('should respect spawn.before deny decision', async () => {
    const emitDecisionFn = vi
      .fn()
      .mockReturnValue(Effect.succeed({ decision: 'deny', reason: 'Not allowed' }));
    const customHooks = { ...mockHooks, emitDecision: emitDecisionFn };
    const customHooksLayer = Layer.succeed(HookService, HookService.make(customHooks as any));
    const customLayer = makeMockLayer({ hooks: customHooksLayer });

    const tool = (await Effect.runPromise(
      (createDispatchAgentTool() as any).pipe(Effect.provide(customLayer as any))
    )) as ToolDefinition;
    try {
      await Effect.runPromise(
        tool.execute(
          { agent: 'explore', prompt: 'test' },
          { projectPath: '/test', sessionId: 'parent-1' }
        ) as any
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Subagent spawn denied');
    }
  });

  it('should emit completion hook', async () => {
    const emitFn = vi.fn().mockReturnValue(Effect.void);
    const customHooks = { ...mockHooks, emit: emitFn };
    const customHooksLayer = Layer.succeed(HookService, HookService.make(customHooks as any));
    const customLayer = makeMockLayer({ hooks: customHooksLayer });

    const tool = (await Effect.runPromise(
      (createDispatchAgentTool() as any).pipe(Effect.provide(customLayer as any))
    )) as ToolDefinition;
    const result = await Effect.runPromise(
      tool.execute(
        { agent: 'explore', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1' }
      )
    );
    expect(emitFn).toHaveBeenCalledWith(
      'agent.subagent.complete',
      expect.objectContaining({ status: 'done' })
    );
  });

  it('observer for agent.subagent.complete can yield* services from dispatch_agent fiber', async () => {
    // Pin the dispatch.ts fix: `agent.subagent.complete` must be emitted in
    // the dispatch_agent tool's Effect.gen fiber (not inside the
    // Effect.async callback's async IIFE), so observers can yield* services
    // like SessionService. Before the fix the emit was wrapped in
    // `await Effect.runPromise(emit)`, which jumped to a fresh fiber with
    // no services and would Die for any observer that yield*'d a service.
    let observerRan = false;
    let sessionResolved = false;

    const realHooksLayer = HookService.Default;
    const customLayer = makeMockLayer({ hooks: realHooksLayer });

    // Register observer, create the tool, and run the tool all in the same
    // Effect.gen so they share the same HookService instance (a fresh
    // HookService is built each time a layer is provided, so splitting this
    // across multiple Effect.runPromise calls would register on one
    // instance and emit on a different one).
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register(
        'agent.subagent.complete',
        (_payload) =>
          Effect.gen(function* () {
            const session = yield* SessionService;
            observerRan = true;
            sessionResolved = typeof session.create === 'function';
          }),
        { source: 'system' }
      );
      const tool = yield* createDispatchAgentTool();
      return yield* tool.execute(
        { agent: 'explore', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1' }
      ) as Effect.Effect<string, any, any>;
    });

    await Effect.runPromise(Effect.provide(program, customLayer as any));

    expect(observerRan).toBe(true);
    expect(sessionResolved).toBe(true);
  });

  it('should pass systemOverride with profile prompt, environment info, and user rules', async () => {
    let capturedSystemOverride: string | undefined;
    mockSubagentRunner.runStream.mockImplementation(async function* (opts: any) {
      capturedSystemOverride = opts.systemOverride;
      yield { _tag: 'Done' as const, content: 'done' };
    } as any);
    const tool = await makeTool();
    await Effect.runPromise(
      tool.execute(
        { agent: 'explore', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1' }
      )
    );
    expect(capturedSystemOverride).toBeTruthy();
    // Should contain the profile's system prompt content
    expect(capturedSystemOverride).toContain('read-only');
    // Should contain inherited environment info
    expect(capturedSystemOverride).toContain('Working directory');
    expect(capturedSystemOverride).toContain('/test');
    expect(capturedSystemOverride).toContain('Operating system');
  });

  it('should handle subagent error', async () => {
    mockSubagentRunner.runStream.mockImplementation(async function* () {
      yield { _tag: 'Error' as const, error: { message: 'Something went wrong' } };
    } as any);
    const tool = await makeTool();
    try {
      await Effect.runPromise(
        tool.execute(
          { agent: 'explore', prompt: 'test' },
          { projectPath: '/test', sessionId: 'parent-1' }
        ) as any
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Subagent failed');
    }
  });

  it('should use LLM from factory.getLLMClient when profile has no model field', async () => {
    let capturedLlm: any;
    mockSubagentRunner.runStream.mockImplementation(async function* (opts: any) {
      capturedLlm = opts.llm;
      yield { _tag: 'Done' as const, content: 'done' };
    } as any);
    const tool = await makeTool();
    await Effect.runPromise(
      tool.execute(
        { agent: 'explore', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1' }
      )
    );
    expect(mockLLMFactory.getLLMClient).toHaveBeenCalled();
    expect(capturedLlm).toBe(mockDefaultLlm);
  });

  it('should create a new llm client when profile specifies a model', async () => {
    let capturedLlm: any;
    mockSubagentRunner.runStream.mockImplementation(async function* (opts: any) {
      capturedLlm = opts.llm;
      yield { _tag: 'Done' as const, content: 'done' };
    } as any);
    const tool = await makeTool();
    await Effect.runPromise(
      tool.execute(
        { agent: 'custom-model-agent', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1' }
      ) as any
    );
    expect(mockLLMFactory.findModel).toHaveBeenCalledWith('fast-model@API_KEY_B');
    expect(mockLLMFactory.createClient).toHaveBeenCalledWith(mockModelEntry);
    expect(capturedLlm).toBe(mockSubagentLlm);
  });

  it('should throw when profile model is not found in catalog', async () => {
    const tool = await makeTool();
    try {
      await Effect.runPromise(
        tool.execute(
          { agent: 'bad-model-agent', prompt: 'test' },
          { projectPath: '/test', sessionId: 'parent-1' }
        ) as any
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('unknown model');
    }
  });

  it('should call session.create with model and parentSessionId in opts', async () => {
    const createFn = vi.fn().mockReturnValue(
      Effect.succeed({
        sessionId: 'child-456',
        cwd: '/test',
        projectPath: 'test',
        transcriptPath: '/tmp/test.jsonl',
        indexPath: '/tmp/test.index.json',
        messageCount: 0,
        currentTurnId: 0,
        sessionMeta: null,
        title: 'child',
        usage: undefined,
        memorySnapshot: '',
      })
    );
    const customSession = { ...mockSession, create: createFn };
    const customSessionLayer = Layer.succeed(
      SessionService,
      SessionService.make(customSession as any)
    );
    const customLayer = makeMockLayer({ session: customSessionLayer });

    const tool = (await Effect.runPromise(
      (createDispatchAgentTool() as any).pipe(Effect.provide(customLayer as any))
    )) as ToolDefinition;
    await Effect.runPromise(
      tool.execute(
        { agent: 'explore', prompt: 'test child' },
        { projectPath: '/test', sessionId: 'parent-1' }
      )
    );
    expect(createFn).toHaveBeenCalledWith(
      '/test',
      expect.objectContaining({
        model: expect.any(String),
        mode: 'build',
        // EXPLORE_PROFILE.permissionMode === 'bypass', which the dispatch
        // tool now reads from the subagent's own profile.
        permissionMode: 'bypass',
      }),
      expect.objectContaining({ parentSessionId: 'parent-1', agentName: 'explore' })
    );
  });

  it('runStream receives state with child sessionId', async () => {
    let capturedState: any;
    mockSubagentRunner.runStream.mockImplementation(async function* (opts: any) {
      capturedState = opts.state;
      yield { _tag: 'Done' as const, content: 'done' };
    } as any);
    const tool = await makeTool();
    await Effect.runPromise(
      tool.execute(
        { agent: 'explore', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1' }
      )
    );
    expect(capturedState).toBeDefined();
    expect(capturedState.sessionId).toBe('child-123');
  });
});
