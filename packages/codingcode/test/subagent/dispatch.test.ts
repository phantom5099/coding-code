import { expect, it, describe, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { createDispatchAgentTool } from '../../src/tools/domains/subagent/dispatch';
import { SubagentRegistry, EXPLORE_PROFILE, setSubagentEnabledState } from '../../src/subagent/registry';
import { SubagentRegistryLayer } from '../../src/layer';
import { registerEmitter, unregisterEmitter, hasEmitter } from '../../src/approval/async-confirm';

const mockMcp = {
  connectServers: () => Effect.void,
  disconnectServers: () => Effect.void,
  getServerToolNames: () => [] as string[],
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

describe('dispatch_agent tool', () => {
  beforeEach(() => {
    // Reset module-level enabled state between tests to prevent state pollution
    setSubagentEnabledState(true);
  });
  async function makeRegistry(): Promise<SubagentRegistry> {
    return await Effect.runPromise(
      Effect.gen(function* () { return yield* SubagentRegistry; }).pipe(
        Effect.provide(SubagentRegistryLayer),
      ),
    );
  }

  it('should create dispatch tool with description listing available profiles', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE);

    const deps = {
      session: {} as any,
      approval: {} as any,
      hooks: {} as any,
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps);

    expect(tool.name).toBe('dispatch_agent');
    expect(tool.description).toContain('explore');
    expect(tool.description).toContain('Available profiles');
  });

  it('should be a core tool (not deferred)', async () => {
    const registry = await makeRegistry();

    const deps = {
      session: {} as any,
      approval: {} as any,
      hooks: {} as any,
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps);

    expect(tool.deferred).toBeFalsy();
  });

  it('should validate agent profile exists', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE);

    const deps = {
      session: {} as any,
      approval: {} as any,
      hooks: {} as any,
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps);

    try {
      await tool.execute(
        { agent: 'unknown-agent', prompt: 'test' },
        {},
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Unknown subagent');
    }
  });

  it('should require agentRunner context', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE);

    const deps = {
      session: {} as any,
      approval: {} as any,
      hooks: {} as any,
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps);

    try {
      await tool.execute(
        { agent: 'explore', prompt: 'test' },
        { /* no agentRunner */ },
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('agentRunner');
    }
  });

  it('should emit spawn.before hook', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE);

    const emitDecisionFn = vi.fn(() => Effect.succeed(null));
    const emitFn = vi.fn(() => Effect.succeed(undefined));

    const deps = {
      session: {
        create: () => Effect.sync(() => ({ sessionId: 'child' })),
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: emitFn,
        emitDecision: emitDecisionFn,
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);

    try {
      await tool.execute(
        { agent: 'explore', prompt: 'test task' },
        {
          agentRunner: {
            agentService: {
              runStream: async function* () {
                yield { _tag: 'Done', content: 'Complete' };
              },
            },
            llm: {},
          },
          agentId: 'parent-agent',
          sessionId: 'parent-session',
        },
      );
    } catch (e) {
      // Might fail due to mocking, but we're testing the hook emission
    }

    expect(emitDecisionFn).toHaveBeenCalledWith(
      'agent.subagent.spawn.before',
      expect.objectContaining({ profile: 'explore' }),
    );
  });

  it('should respect spawn.before deny decision', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE);

    const deps = {
      session: {} as any,
      approval: {} as any,
      hooks: {
        emit: (() => Effect.succeed(undefined)) as any,
        emitDecision: (() => Effect.succeed({
          decision: 'deny',
          reason: 'Not allowed',
        })) as any,
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);

    try {
      await tool.execute(
        { agent: 'explore', prompt: 'test' },
        {
          agentRunner: {
            agentService: {},
            llm: {},
          },
        },
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Subagent spawn denied');
      expect(e.message).toContain('Not allowed');
    }
  });

  it('should emit completion hook', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE);

    const emitFn = vi.fn(() => Effect.succeed(undefined));

    const deps = {
      session: {
        create: () => Effect.sync(() => ({ sessionId: 'child' })),
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: emitFn,
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);

    const agentService = {
      runStream: async function* () {
        yield { _tag: 'Done', content: 'Subagent completed' };
      },
    };

    const result = await tool.execute(
      { agent: 'explore', prompt: 'test' },
      {
        agentRunner: {
          agentService,
          llm: {},
        },
        agentId: 'parent',
        sessionId: 'parent-session',
      },
    );

    expect(result).toContain('Subagent completed');
    expect(emitFn).toHaveBeenCalledWith(
      'agent.subagent.complete',
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('should pass systemPrompt from profile', async () => {
    const registry = await makeRegistry();

    const customProfile = {
      ...EXPLORE_PROFILE,
      name: 'custom',
      systemPrompt: 'Custom system prompt',
    };
    registry.register(customProfile);

    const runStreamCalls: any[] = [];
    const agentService = {
      runStream: (opts: any) => {
        runStreamCalls.push(opts);
        return (async function* () {
          yield { _tag: 'Done', content: 'Done' };
        })();
      },
    };

    const deps = {
      session: {
        create: () => Effect.sync(() => ({ sessionId: 'child' })),
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);

    await tool.execute(
      { agent: 'custom', prompt: 'test' },
      {
        agentRunner: { agentService, llm: {} },
        agentId: 'parent',
        sessionId: 'parent-session',
      },
    );

    expect(runStreamCalls[0].systemOverride).toBe('Custom system prompt');
  });

  it('should filter dispatch_agent from coreAllowlist', async () => {
    const registry = await makeRegistry();

    const toolListProfile = {
      name: 'tool-list',
      description: 'Profile with tools',
      systemPrompt: 'System',
      tools: ['read_file', 'bash', 'dispatch_agent'],
    };
    registry.register(toolListProfile);

    const runStreamCalls: any[] = [];
    const agentService = {
      runStream: (opts: any) => {
        runStreamCalls.push(opts);
        return (async function* () {
          yield { _tag: 'Done', content: 'Done' };
        })();
      },
    };

    const deps = {
      session: {
        create: () => Effect.sync(() => ({ sessionId: 'child' })),
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);

    await tool.execute(
      { agent: 'tool-list', prompt: 'test' },
      {
        agentRunner: { agentService, llm: {} },
        agentId: 'parent',
        sessionId: 'parent-session',
      },
    );

    // dispatch_agent should be filtered out from allowlist
    const allowlist = runStreamCalls[0].coreAllowlist;
    expect(allowlist?.has('read_file')).toBe(true);
    expect(allowlist?.has('bash')).toBe(true);
    expect(allowlist?.has('dispatch_agent')).toBe(false);
  });

  it('should handle subagent error', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE);

    const emitFn = vi.fn(() => Effect.succeed(undefined));

    const agentService = {
      runStream: async function* () {
        yield { _tag: 'Error', error: { message: 'Subagent failed', code: 'ERROR' } };
      },
    };

    const deps = {
      session: {
        create: () => Effect.sync(() => ({ sessionId: 'child' })),
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: emitFn,
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);

    try {
      await tool.execute(
        { agent: 'explore', prompt: 'test' },
        {
          agentRunner: { agentService, llm: {} },
          agentId: 'parent',
          sessionId: 'parent-session',
        },
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Subagent failed');
    }

    expect(emitFn).toHaveBeenCalledWith(
      'agent.subagent.complete',
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('should use parent llm when profile has no model field', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE); // EXPLORE_PROFILE has no model field

    const runStreamCalls: any[] = [];
    const agentService = {
      runStream: (opts: any) => {
        runStreamCalls.push(opts);
        return (async function* () { yield { _tag: 'Done', content: 'Done' }; })();
      },
    };
    const parentLlm = { _tag: 'parent-llm' };

    const deps = {
      session: {
        create: () => Effect.sync(() => ({})),
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);
    await tool.execute(
      { agent: 'explore', prompt: 'test' },
      { agentRunner: { agentService, llm: parentLlm }, agentId: 'parent', sessionId: 'parent-session' },
    );

    expect(runStreamCalls[0].llm).toBe(parentLlm);
  });

  it('should create a new llm client when profile specifies a model', async () => {
    const registry = await makeRegistry();

    const modelProfile = {
      ...EXPLORE_PROFILE,
      name: 'model-agent',
      model: 'fast-model@API_KEY_B',
    };
    registry.register(modelProfile);

    const runStreamCalls: any[] = [];
    const agentService = {
      runStream: (opts: any) => {
        runStreamCalls.push(opts);
        return (async function* () { yield { _tag: 'Done', content: 'Done' }; })();
      },
    };
    const parentLlm = { _tag: 'parent-llm' };

    const deps = {
      session: {
        create: () => Effect.sync(() => ({})),
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);
    await tool.execute(
      { agent: 'model-agent', prompt: 'test' },
      { agentRunner: { agentService, llm: parentLlm }, agentId: 'parent', sessionId: 'parent-session' },
    );

    // Should use the resolved subagent LLM, not the parent's
    expect(runStreamCalls[0].llm).toBe(mockSubagentLlm);
    expect(runStreamCalls[0].llm).not.toBe(parentLlm);
  });

  it('should throw when profile model is not found in catalog', async () => {
    const registry = await makeRegistry();

    const badProfile = {
      ...EXPLORE_PROFILE,
      name: 'bad-model-agent',
      model: 'nonexistent-model@unknown',
    };
    registry.register(badProfile);

    const deps = {
      session: {} as any,
      approval: {} as any,
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);

    try {
      await tool.execute(
        { agent: 'bad-model-agent', prompt: 'test' },
        { agentRunner: { agentService: {}, llm: {} } },
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('unknown model');
      expect(e.message).toContain('nonexistent-model@unknown');
    }
  });

  it('should throw when subagent registry is disabled', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE);
    registry.setEnabled(false);

    const deps = {
      session: {} as any,
      approval: {} as any,
      hooks: {
        emit: (() => Effect.succeed(undefined)) as any,
        emitDecision: (() => Effect.succeed(null)) as any,
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);

    try {
      await tool.execute(
        { agent: 'explore', prompt: 'test' },
        { agentRunner: { agentService: {}, llm: {} } },
      );
      expect.fail('Should have thrown error');
    } catch (e: any) {
      expect(e.message).toContain('Subagent is disabled');
    }
  });

  it('should call session.create with plain UUID sessionId and parentSessionId in opts', async () => {
    const registry = await makeRegistry();
    registry.setEnabled(true);
    registry.register(EXPLORE_PROFILE);

    const createCalls: any[] = [];
    const agentService = {
      runStream: async function* () { yield { _tag: 'Done', content: 'done' }; },
    };

    const deps = {
      session: {
        create: (...args: any[]) => {
          createCalls.push(args);
          return Effect.sync(() => ({}));
        },
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);
    await tool.execute(
      { agent: 'explore', prompt: 'task' },
      { agentRunner: { agentService, llm: {} }, agentId: 'main:parent', sessionId: 'parent-session-uuid' },
    );

    expect(createCalls.length).toBe(1);
    const [, , , childUuid, opts] = createCalls[0];
    // sessionId must be a plain UUID (no colon)
    expect(typeof childUuid).toBe('string');
    expect(childUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(childUuid).not.toContain(':');
    // opts must carry parentSessionId from ctx
    expect(opts?.parentSessionId).toBe('parent-session-uuid');
    expect(opts?.agentName).toBe('explore');
  });

  it('runStream receives agentId as profile.name:childUuid', async () => {
    const registry = await makeRegistry();
    registry.setEnabled(true);
    registry.register(EXPLORE_PROFILE);

    const createCalls: any[] = [];
    const runStreamCalls: any[] = [];
    const agentService = {
      runStream: (opts: any) => {
        runStreamCalls.push(opts);
        return (async function* () { yield { _tag: 'Done', content: 'done' }; })();
      },
    };

    const deps = {
      session: {
        create: (...args: any[]) => {
          createCalls.push(args);
          return Effect.sync(() => ({}));
        },
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);
    await tool.execute(
      { agent: 'explore', prompt: 'task' },
      { agentRunner: { agentService, llm: {} }, agentId: 'main:parent', sessionId: 'p' },
    );

    const childUuid = createCalls[0][3];
    expect(runStreamCalls[0].agentId).toBe(`explore:${childUuid}`);
  });

  it('registers delegated emitter for child session when parentSessionId is provided', async () => {
    const registry = await makeRegistry();
    registry.setEnabled(true);
    registry.register(EXPLORE_PROFILE);

    const parentSid = 'parent-emitter-test-' + Math.random().toString(36).slice(2);
    let capturedChildUuid: string | undefined;

    // Register a parent emitter
    registerEmitter(parentSid, () => {});

    let createCalls: any[] = [];
    const agentService = {
      runStream: async function* () { yield { _tag: 'Done', content: 'done' }; },
    };

    const deps = {
      session: {
        create: (...args: any[]) => {
          createCalls.push(args);
          return Effect.sync(() => ({}));
        },
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);
    await tool.execute(
      { agent: 'explore', prompt: 'task' },
      { agentRunner: { agentService, llm: {} }, agentId: 'parent', sessionId: parentSid },
    );

    capturedChildUuid = createCalls[0][3];

    // After completion, child emitter should be cleaned up
    expect(hasEmitter(capturedChildUuid!)).toBe(false);

    unregisterEmitter(parentSid);
  });

  it('unregisters child emitter even when subagent throws an error', async () => {
    const registry = await makeRegistry();
    registry.setEnabled(true);
    registry.register(EXPLORE_PROFILE);

    const parentSid = 'parent-error-test-' + Math.random().toString(36).slice(2);
    registerEmitter(parentSid, () => {});

    let createCalls: any[] = [];
    const agentService = {
      runStream: async function* () {
        yield { _tag: 'Error', error: { message: 'boom' } };
      },
    };

    const deps = {
      session: {
        create: (...args: any[]) => {
          createCalls.push(args);
          return Effect.sync(() => ({}));
        },
        incrementTurn: () => 1,
        recordUser: () => Effect.succeed({ type: 'user', uuid: 'u1', content: '', turnId: 1, timestamp: '' }),
      },
      approval: {
        fork: () => Effect.succeed({
          getPermissionMode: () => 'default',
          evaluate: () => Effect.succeed({ decision: 'allow' }),
          addRule: () => Effect.succeed(undefined),
          removeRule: () => Effect.succeed(undefined),
          setPermissionMode: () => Effect.succeed(undefined),
          fork: () => Effect.fail(new Error('nested')),
        }),
      },
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
      mcp: mockMcp,
      registry,
    };

    const tool = createDispatchAgentTool(deps as any);
    try {
      await tool.execute(
        { agent: 'explore', prompt: 'task' },
        { agentRunner: { agentService, llm: {} }, agentId: 'parent', sessionId: parentSid },
      );
    } catch {}

    const capturedChildUuid = createCalls[0]?.[3];
    expect(capturedChildUuid).toBeDefined();
    expect(hasEmitter(capturedChildUuid)).toBe(false);

    unregisterEmitter(parentSid);
  });
});
