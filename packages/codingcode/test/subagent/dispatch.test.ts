import { expect, it, describe, vi } from 'vitest';
import { Effect } from 'effect';
import { createDispatchAgentTool } from '../../src/tools/domains/subagent/dispatch';
import { SubagentRegistry, EXPLORE_PROFILE } from '../../src/subagent/registry';
import { SubagentRegistryLayer } from '../../src/layer';

const mockModelEntry = {
  id: 'fast-model@provider-b',
  provider: 'provider-b',
  driver: 'openai',
  name: 'Fast Model',
  model: 'fast-model',
  base_url: 'https://api.b.com',
  api_key_env: 'API_KEY_B',
};
const mockSubagentLlm = { _tag: 'subagent-llm' };

vi.mock('../../src/llm/factory.js', () => ({
  listModels: vi.fn(() => ({ ok: true, value: [mockModelEntry] })),
  createClient: vi.fn(async () => ({ ok: true, value: mockSubagentLlm })),
}));

describe('dispatch_agent tool', () => {
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
      agentIdResolver: {} as any,
      approval: {} as any,
      hooks: {} as any,
      registry,
    };

    const tool = createDispatchAgentTool(deps);

    expect(tool.name).toBe('dispatch_agent');
    expect(tool.description).toContain('explore');
    expect(tool.description).toContain('Available profiles');
  });

  it('should have deferred flag set to true', async () => {
    const registry = await makeRegistry();

    const deps = {
      session: {} as any,
      agentIdResolver: {} as any,
      approval: {} as any,
      hooks: {} as any,
      registry,
    };

    const tool = createDispatchAgentTool(deps);

    expect(tool.deferred).toBe(true);
  });

  it('should validate agent profile exists', async () => {
    const registry = await makeRegistry();
    registry.register(EXPLORE_PROFILE);

    const deps = {
      session: {} as any,
      agentIdResolver: {} as any,
      approval: {} as any,
      hooks: {} as any,
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
      agentIdResolver: {} as any,
      approval: {} as any,
      hooks: {} as any,
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
      },
      agentIdResolver: { resolve: () => 'child-agent' },
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
      agentIdResolver: {} as any,
      approval: {} as any,
      hooks: {
        emit: (() => Effect.succeed(undefined)) as any,
        emitDecision: (() => Effect.succeed({
          decision: 'deny',
          reason: 'Not allowed',
        })) as any,
      },
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
      },
      agentIdResolver: { resolve: () => 'child-agent' },
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
      },
      agentIdResolver: { resolve: () => 'child-agent' },
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
      },
      agentIdResolver: { resolve: () => 'child-agent' },
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
      },
      agentIdResolver: { resolve: () => 'child-agent' },
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
      session: { create: () => Effect.sync(() => ({})) },
      agentIdResolver: { resolve: () => 'child-agent' },
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
      model: 'fast-model@provider-b',
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
      session: { create: () => Effect.sync(() => ({})) },
      agentIdResolver: { resolve: () => 'child-agent' },
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
      agentIdResolver: {} as any,
      approval: {} as any,
      hooks: {
        emit: () => Effect.succeed(undefined),
        emitDecision: () => Effect.succeed(null),
      },
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
});
