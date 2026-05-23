import { expect, it, describe, vi } from 'vitest';
import { Effect } from 'effect';
import { createDispatchAgentTool } from '../../src/subagent/dispatch-tool';
import { SubagentRegistry, EXPLORE_PROFILE } from '../../src/subagent/registry';

describe('dispatch_agent tool', () => {
  it('should create dispatch tool with description listing available profiles', () => {
    const registry = Effect.runSync(SubagentRegistry);
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

  it('should have deferred flag set to true', () => {
    const registry = Effect.runSync(SubagentRegistry);
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
    const registry = Effect.runSync(SubagentRegistry);
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
    const registry = Effect.runSync(SubagentRegistry);
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
    const registry = Effect.runSync(SubagentRegistry);
    registry.register(EXPLORE_PROFILE);

    const emitDecisionFn = vi.fn(async () => null);
    const emitFn = vi.fn(async () => {});

    const deps = {
      session: {
        create: () => Effect.sync(() => ({ sessionId: 'child' })),
      },
      agentIdResolver: { resolve: () => 'child-agent' },
      approval: {
        fork: () => Effect.succeed({ getPermissionMode: () => 'default' }),
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
    const registry = Effect.runSync(SubagentRegistry);
    registry.register(EXPLORE_PROFILE);

    const deps = {
      session: {} as any,
      agentIdResolver: {} as any,
      approval: {} as any,
      hooks: {
        emit: async () => {},
        emitDecision: async () => ({
          decision: 'deny',
          reason: 'Not allowed',
        }),
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
    const registry = Effect.runSync(SubagentRegistry);
    registry.register(EXPLORE_PROFILE);

    const emitFn = vi.fn(async () => {});

    const deps = {
      session: {
        create: () => Effect.sync(() => ({ sessionId: 'child' })),
      },
      agentIdResolver: { resolve: () => 'child-agent' },
      approval: {
        fork: () => Effect.succeed({ getPermissionMode: () => 'default' }),
      },
      hooks: {
        emit: emitFn,
        emitDecision: async () => null,
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
    const registry = Effect.runSync(SubagentRegistry);

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
        fork: () => Effect.succeed({ getPermissionMode: () => 'default' }),
      },
      hooks: {
        emit: async () => {},
        emitDecision: async () => null,
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
    const registry = Effect.runSync(SubagentRegistry);

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
        fork: () => Effect.succeed({ getPermissionMode: () => 'default' }),
      },
      hooks: {
        emit: async () => {},
        emitDecision: async () => null,
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
    const registry = Effect.runSync(SubagentRegistry);
    registry.register(EXPLORE_PROFILE);

    const emitFn = vi.fn(async () => {});

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
        fork: () => Effect.succeed({ getPermissionMode: () => 'default' }),
      },
      hooks: {
        emit: emitFn,
        emitDecision: async () => null,
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
});
