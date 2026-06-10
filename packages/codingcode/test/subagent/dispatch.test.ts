import { expect, it, describe, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { createDispatchAgentTool } from '../../src/tools/domains/subagent/dispatch';
import { EXPLORE_PROFILE } from '../../src/subagent/registry';
import type { AgentProfile } from '../../src/subagent/registry';
import type { ProjectRuntimeService } from '../../src/runtime/project-runtime';

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
      promptEstimate: 0,
    }),
  incrementTurn: () => 0,
  recordUser: () =>
    Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 0, timestamp: '' }),
  recordAssistant: () =>
    Effect.succeed({
      type: 'assistant',
      uuid: 'a1',
      content: '',
      toolCalls: [],
      model: 'test',
      turnId: 0,
      timestamp: '',
    }),
  recordToolResult: () =>
    Effect.succeed({
      type: 'tool_result',
      uuid: 't1',
      parentUuid: 'a1',
      toolName: 'test',
      toolCallId: 'tc1',
      output: '',
      turnId: 0,
      timestamp: '',
      tokenCount: 0,
    }),
};

const mockRuntime: ProjectRuntimeService = {
  _tag: 'ProjectRuntime' as const,
  prepareProject: (_p: string) => Effect.void,
  resolveMainAgentProfile: (_p: string, _s: string): AgentProfile | undefined => EXPLORE_PROFILE,
  resolveSubagentProfile: (_p: string, name: string) => {
    if (name === 'explore') return EXPLORE_PROFILE;
    return undefined;
  },
  listAgentProfiles: (_p: string) => [EXPLORE_PROFILE],
  getToolPolicy: (profile: AgentProfile | undefined) => ({
    allowedTools: profile?.tools ? new Set(profile.tools) : undefined,
    allowedMcpServers: profile?.mcpServers ? new Set(profile.mcpServers) : undefined,
    allowToolSearch: true,
    allowDeferredTools: false,
  }),
  setSessionProfile: (_s: string, _p: AgentProfile) => {},
  getSessionProfile: (_s: string) => undefined,
  disposeSession: (_s: string) => Effect.void,
  disposeProject: (_p: string) => Effect.void,
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
const mockSubagentLlm = { _tag: 'subagent-llm' };

vi.mock('../../src/llm/factory.js', () => ({
  findModel: vi.fn((target: string) => {
    if (target === 'fast-model@API_KEY_B') {
      return mockModelEntry;
    }
    return null;
  }),
  createClient: vi.fn(async () => ({ ok: true, value: mockSubagentLlm })),
}));

function makeTool() {
  return createDispatchAgentTool({
    session: mockSession as any,
    approval: mockApproval as any,
    hooks: mockHooks as any,
    runtime: mockRuntime,
    mcp: mockMcp as any,
  });
}

describe('dispatch_agent tool', () => {
  beforeEach(() => {});

  it('should create dispatch tool with description mentioning profiles', () => {
    const tool = makeTool();
    expect(tool.name).toBe('dispatch_agent');
    expect(tool.description).toContain('Spawn');
    expect(tool.description).toContain('subagent');
  });

  it('should be a core tool (not deferred)', () => {
    const tool = makeTool();
    expect(tool.deferred).toBeUndefined();
  });

  it('should validate agent profile exists', async () => {
    const tool = makeTool();
    try {
      await tool.execute(
        { agent: 'nonexistent', prompt: 'do something' },
        { projectPath: '/test' }
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Unknown subagent');
    }
  });

  it('should require agentRunner context', async () => {
    const tool = makeTool();
    try {
      await tool.execute({ agent: 'explore', prompt: 'do something' }, { projectPath: '/test' });
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('agentRunner');
    }
  });

  it('should emit spawn.before hook', async () => {
    const emitDecisionFn = vi.fn().mockReturnValue(Effect.succeed(null));
    const tool = createDispatchAgentTool({
      session: mockSession as any,
      approval: mockApproval as any,
      hooks: { ...mockHooks, emitDecision: emitDecisionFn } as any,
      runtime: mockRuntime,
      mcp: mockMcp as any,
    });
    const runStream = async function* () {
      yield { _tag: 'Done' as const, content: 'done' };
    };
    const agentRunner = { agentService: { runStream }, llm: {} };
    await tool.execute(
      { agent: 'explore', prompt: 'test' },
      { projectPath: '/test', sessionId: 'parent-1', agentRunner }
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
    const tool = createDispatchAgentTool({
      session: mockSession as any,
      approval: mockApproval as any,
      hooks: { ...mockHooks, emitDecision: emitDecisionFn } as any,
      runtime: mockRuntime,
      mcp: mockMcp as any,
    });
    const agentRunner = { agentService: { runStream: async function* () {} }, llm: {} };
    try {
      await tool.execute(
        { agent: 'explore', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1', agentRunner }
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Subagent spawn denied');
    }
  });

  it('should emit completion hook', async () => {
    const emitFn = vi.fn().mockReturnValue(Effect.void);
    const tool = createDispatchAgentTool({
      session: mockSession as any,
      approval: mockApproval as any,
      hooks: { ...mockHooks, emit: emitFn } as any,
      runtime: mockRuntime,
      mcp: mockMcp as any,
    });
    const runStream = async function* () {
      yield { _tag: 'Done' as const, content: 'completed' };
    };
    const agentRunner = { agentService: { runStream }, llm: {} };
    const result = await tool.execute(
      { agent: 'explore', prompt: 'test' },
      { projectPath: '/test', sessionId: 'parent-1', agentRunner }
    );
    expect(emitFn).toHaveBeenCalledWith(
      'agent.subagent.complete',
      expect.objectContaining({ status: 'done' })
    );
  });

  it('should pass systemOverride with profile prompt, environment info, and user rules', async () => {
    const tool = makeTool();
    let capturedSystemOverride: string | undefined;
    const runStream = async function* (opts: any) {
      capturedSystemOverride = opts.systemOverride;
      yield { _tag: 'Done' as const, content: 'done' };
    };
    const agentRunner = { agentService: { runStream }, llm: {} };
    await tool.execute(
      { agent: 'explore', prompt: 'test' },
      { projectPath: '/test', sessionId: 'parent-1', agentRunner }
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
    const tool = makeTool();
    const runStream = async function* () {
      yield { _tag: 'Error' as const, error: { message: 'Something went wrong' } };
    };
    const agentRunner = { agentService: { runStream }, llm: {} };
    try {
      await tool.execute(
        { agent: 'explore', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1', agentRunner }
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Subagent failed');
    }
  });

  it('should use parent llm when profile has no model field', async () => {
    const tool = makeTool();
    const parentLlm = { _tag: 'parent-llm' };
    let capturedLlm: any;
    const runStream = async function* (opts: any) {
      capturedLlm = opts.llm;
      yield { _tag: 'Done' as const, content: 'done' };
    };
    const agentRunner = { agentService: { runStream }, llm: parentLlm };
    await tool.execute(
      { agent: 'explore', prompt: 'test' },
      { projectPath: '/test', sessionId: 'parent-1', agentRunner }
    );
    expect(capturedLlm).toBe(parentLlm);
  });

  it('should create a new llm client when profile specifies a model', async () => {
    const profileWithModel: AgentProfile = {
      name: 'custom-model-agent',
      description: 'Agent with custom model',
      systemPrompt: 'Custom model agent',
      model: 'fast-model@API_KEY_B',
      tools: ['read_file'],
    };
    const runtimeWithProfile = {
      ...mockRuntime,
      resolveSubagentProfile: (_p: string, name: string) => {
        if (name === 'custom-model-agent') return profileWithModel;
        return undefined;
      },
    };
    const tool = createDispatchAgentTool({
      session: mockSession as any,
      approval: mockApproval as any,
      hooks: mockHooks as any,
      runtime: runtimeWithProfile,
      mcp: mockMcp as any,
    });
    const { createClient } = await import('../../src/llm/factory.js');
    let capturedLlm: any;
    const runStream = async function* (opts: any) {
      capturedLlm = opts.llm;
      yield { _tag: 'Done' as const, content: 'done' };
    };
    const agentRunner = { agentService: { runStream }, llm: {} };
    await tool.execute(
      { agent: 'custom-model-agent', prompt: 'test' },
      { projectPath: '/test', sessionId: 'parent-1', agentRunner }
    );
    expect(createClient).toHaveBeenCalledWith(mockModelEntry);
    expect(capturedLlm).toBe(mockSubagentLlm);
  });

  it('should throw when profile model is not found in catalog', async () => {
    const profileWithBadModel: AgentProfile = {
      name: 'bad-model-agent',
      description: 'Agent with unknown model',
      systemPrompt: 'Bad model',
      model: 'nonexistent-model@unknown',
      tools: ['read_file'],
    };
    const runtimeWithBadProfile = {
      ...mockRuntime,
      resolveSubagentProfile: (_p: string, name: string) => {
        if (name === 'bad-model-agent') return profileWithBadModel;
        return undefined;
      },
    };
    const tool = createDispatchAgentTool({
      session: mockSession as any,
      approval: mockApproval as any,
      hooks: mockHooks as any,
      runtime: runtimeWithBadProfile,
      mcp: mockMcp as any,
    });
    const agentRunner = { agentService: { runStream: async function* () {} }, llm: {} };
    try {
      await tool.execute(
        { agent: 'bad-model-agent', prompt: 'test' },
        { projectPath: '/test', sessionId: 'parent-1', agentRunner }
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('unknown model');
    }
  });

  it('should call session.create with plain UUID sessionId and parentSessionId in opts', async () => {
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
        promptEstimate: 0,
      })
    );
    const tool = createDispatchAgentTool({
      session: { ...mockSession, create: createFn } as any,
      approval: mockApproval as any,
      hooks: mockHooks as any,
      runtime: mockRuntime,
      mcp: mockMcp as any,
    });
    const runStream = async function* () {
      yield { _tag: 'Done' as const, content: 'done' };
    };
    const agentRunner = { agentService: { runStream }, llm: {} };
    await tool.execute(
      { agent: 'explore', prompt: 'test child' },
      { projectPath: '/test', sessionId: 'parent-1', agentRunner }
    );
    expect(createFn).toHaveBeenCalledWith(
      '/test',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ parentSessionId: 'parent-1', agentName: 'explore' })
    );
  });

  it('runStream receives state with child sessionId', async () => {
    let capturedState: any;
    const runStream = async function* (opts: any) {
      capturedState = opts.state;
      yield { _tag: 'Done' as const, content: 'done' };
    };
    const tool = createDispatchAgentTool({
      session: mockSession as any,
      approval: mockApproval as any,
      hooks: mockHooks as any,
      runtime: mockRuntime,
      mcp: mockMcp as any,
    });
    const agentRunner = { agentService: { runStream }, llm: {} };
    await tool.execute(
      { agent: 'explore', prompt: 'test' },
      { projectPath: '/test', sessionId: 'parent-1', agentRunner }
    );
    expect(capturedState).toBeDefined();
    expect(capturedState.sessionId).toBe('child-123');
  });
});
