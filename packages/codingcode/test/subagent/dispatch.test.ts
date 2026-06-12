import { expect, it, describe, vi, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { createDispatchAgentTool } from '../../src/tools/domains/subagent/dispatch.js';
import { SessionService } from '../../src/session/store.js';
import { ApprovalService } from '../../src/approval/index.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
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
      promptEstimate: 0,
      memorySnapshot: '',
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
  hideMessage: () => Effect.succeed({ type: 'hide', uuid: 'h1', kind: 'message', targetUuid: '', reason: '', timestamp: '' }),
  rollbackToTurn: () => Effect.succeed({ type: 'hide', uuid: 'h1', kind: 'rollback', throughTurnId: 0, reason: '', timestamp: '' }),
  forkSession: () => Effect.succeed('forked-session-id'),
  renameSession: () => Effect.succeed({ type: 'title', uuid: 't1', text: '', timestamp: '' }),
  readHistory: () => Effect.succeed([]),
  readMessages: () => Effect.succeed([]),
  listSessions: () => Effect.succeed([]),
  findSessionIndex: () => Effect.succeed(null),
  getSessionId: () => 'test-session',
  getMessageCount: () => 0,
  setPermissionMode: () => Effect.void,
  getPermissionMode: () => Effect.succeed('default'),
};

const MockSessionLayer = Layer.succeed(SessionService, SessionService.make(mockSession as any));
const MockApprovalLayer = Layer.succeed(ApprovalService, ApprovalService.make(mockApproval as any));
const MockHooksLayer = Layer.succeed(HookService, HookService.make(mockHooks as any));
const MockMcpLayer = Layer.succeed(McpService, McpService.make(mockMcp as any));

const MockLayer = Layer.merge(MockSessionLayer, Layer.merge(MockApprovalLayer, Layer.merge(MockHooksLayer, MockMcpLayer)));

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

async function makeTool(): Promise<ToolDefinition> {
  const result = await Effect.runPromise((createDispatchAgentTool() as any).pipe(Effect.provide(MockLayer as any)));
  return result as ToolDefinition;
}

describe('dispatch_agent tool', () => {
  beforeEach(() => {});

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
    const tool = await makeTool();
    try {
      await tool.execute({ agent: 'explore', prompt: 'do something' }, { projectPath: '/test' });
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('agentRunner');
    }
  });

  it('should emit spawn.before hook', async () => {
    const emitDecisionFn = vi.fn().mockReturnValue(Effect.succeed(null));
    const customHooks = { ...mockHooks, emitDecision: emitDecisionFn };
    const customHooksLayer = Layer.succeed(HookService, HookService.make(customHooks as any));
    const customLayer = Layer.merge(MockSessionLayer, Layer.merge(MockApprovalLayer, Layer.merge(customHooksLayer, MockMcpLayer)));

    const tool = await Effect.runPromise((createDispatchAgentTool() as any).pipe(Effect.provide(customLayer as any))) as ToolDefinition;
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
    const customHooks = { ...mockHooks, emitDecision: emitDecisionFn };
    const customHooksLayer = Layer.succeed(HookService, HookService.make(customHooks as any));
    const customLayer = Layer.merge(MockSessionLayer, Layer.merge(MockApprovalLayer, Layer.merge(customHooksLayer, MockMcpLayer)));

    const tool = await Effect.runPromise((createDispatchAgentTool() as any).pipe(Effect.provide(customLayer as any))) as ToolDefinition;
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
    const customHooks = { ...mockHooks, emit: emitFn };
    const customHooksLayer = Layer.succeed(HookService, HookService.make(customHooks as any));
    const customLayer = Layer.merge(MockSessionLayer, Layer.merge(MockApprovalLayer, Layer.merge(customHooksLayer, MockMcpLayer)));

    const tool = await Effect.runPromise((createDispatchAgentTool() as any).pipe(Effect.provide(customLayer as any))) as ToolDefinition;
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
    const tool = await makeTool();
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
    const tool = await makeTool();
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
    const tool = await makeTool();
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
    const tool = await makeTool();
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
    const tool = await makeTool();
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
        memorySnapshot: '',
      })
    );
    const customSession = { ...mockSession, create: createFn };
    const customSessionLayer = Layer.succeed(SessionService, SessionService.make(customSession as any));
    const customLayer = Layer.merge(customSessionLayer, Layer.merge(MockApprovalLayer, Layer.merge(MockHooksLayer, MockMcpLayer)));

    const tool = await Effect.runPromise((createDispatchAgentTool() as any).pipe(Effect.provide(customLayer as any))) as ToolDefinition;
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
    const tool = await makeTool();
    const agentRunner = { agentService: { runStream }, llm: {} };
    await tool.execute(
      { agent: 'explore', prompt: 'test' },
      { projectPath: '/test', sessionId: 'parent-1', agentRunner }
    );
    expect(capturedState).toBeDefined();
    expect(capturedState.sessionId).toBe('child-123');
  });
});
