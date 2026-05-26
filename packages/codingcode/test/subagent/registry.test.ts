import { expect, it, describe } from 'vitest';
import { Effect } from 'effect';
import { SubagentRegistry, EXPLORE_PROFILE } from '../../src/subagent/registry';
import { SubagentRegistryLayer } from '../../src/layer';

describe('SubagentRegistry', () => {
  const testEffect = (testFn: (registry: SubagentRegistry) => void) => {
    return Effect.gen(function* () {
      const registry = yield* SubagentRegistry;
      testFn(registry);
    }).pipe(Effect.provide(SubagentRegistryLayer));
  };

  it('should register and retrieve profiles', async () => {
    await Effect.runPromise(
      testEffect((registry) => {
        const profile = {
          name: 'test-agent',
          description: 'Test agent',
          systemPrompt: 'You are a test agent',
        };

        registry.register(profile);
        const retrieved = registry.get('test-agent');

        expect(retrieved).toEqual(profile);
      }),
    );
  });

  it('should list all registered profiles', async () => {
    await Effect.runPromise(
      testEffect((registry) => {
        const profile1 = {
          name: 'agent1',
          description: 'First agent',
          systemPrompt: 'System 1',
        };
        const profile2 = {
          name: 'agent2',
          description: 'Second agent',
          systemPrompt: 'System 2',
        };

        registry.register(profile1);
        registry.register(profile2);

        const all = registry.list();
        expect(all.length).toBeGreaterThanOrEqual(2);
        expect(all.some(p => p.name === 'agent1')).toBe(true);
        expect(all.some(p => p.name === 'agent2')).toBe(true);
      }),
    );
  });

  it('should return undefined for unknown profile', async () => {
    await Effect.runPromise(
      testEffect((registry) => {
        const result = registry.get('unknown-agent');
        expect(result).toBeUndefined();
      }),
    );
  });

  it('should support built-in profiles', () => {
    expect(EXPLORE_PROFILE.name).toBe('explore');
    expect(EXPLORE_PROFILE.readonly).toBe(true);
    expect(EXPLORE_PROFILE.maxSteps).toBe(30);
    expect(EXPLORE_PROFILE.tools).toContain('read_file');
  });

  it('should support profile with custom tools and maxSteps', async () => {
    await Effect.runPromise(
      testEffect((registry) => {
        const profile = {
          name: 'custom',
          description: 'Custom agent',
          systemPrompt: 'Custom system',
          tools: ['tool1', 'tool2'],
          readonly: false,
          maxSteps: 15,
        };

        registry.register(profile);
        const retrieved = registry.get('custom');

        expect(retrieved?.tools).toContain('tool1');
        expect(retrieved?.maxSteps).toBe(15);
        expect(retrieved?.readonly).toBe(false);
      }),
    );
  });

  it('should reset the registry', async () => {
    await Effect.runPromise(
      testEffect((registry) => {
        registry.register({
          name: 'temp',
          description: 'Temporary',
          systemPrompt: 'Temp system',
        });

        expect(registry.get('temp')).toBeDefined();

        registry.reset();

        expect(registry.get('temp')).toBeUndefined();
      }),
    );
  });

  it('should default to enabled=true', async () => {
    await Effect.runPromise(
      testEffect((registry) => {
        expect(registry.isEnabled()).toBe(true);
      }),
    );
  });

  it('should allow disabling via setEnabled(false)', async () => {
    await Effect.runPromise(
      testEffect((registry) => {
        registry.setEnabled(false);
        expect(registry.isEnabled()).toBe(false);
      }),
    );
  });

  it('should allow re-enabling via setEnabled(true)', async () => {
    await Effect.runPromise(
      testEffect((registry) => {
        registry.setEnabled(false);
        registry.setEnabled(true);
        expect(registry.isEnabled()).toBe(true);
      }),
    );
  });

  it('should restore enabled=true after reset()', async () => {
    await Effect.runPromise(
      testEffect((registry) => {
        registry.setEnabled(false);
        expect(registry.isEnabled()).toBe(false);
        registry.reset();
        expect(registry.isEnabled()).toBe(true);
      }),
    );
  });

  describe('per-agent disable', () => {
    it('should default to not disabled', async () => {
      await Effect.runPromise(
        testEffect((registry) => {
          expect(registry.isAgentDisabled('any-agent')).toBe(false);
        }),
      );
    });

    it('should disable and re-enable a specific agent', async () => {
      await Effect.runPromise(
        testEffect((registry) => {
          registry.register({ name: 'test', description: 'Test', systemPrompt: 'You are test.' });
          registry.disableAgent('test');
          expect(registry.isAgentDisabled('test')).toBe(true);
          registry.enableAgent('test');
          expect(registry.isAgentDisabled('test')).toBe(false);
        }),
      );
    });

    it('should clear disabled state on reset', async () => {
      await Effect.runPromise(
        testEffect((registry) => {
          registry.register({ name: 'test', description: 'Test', systemPrompt: 'You are test.' });
          registry.disableAgent('test');
          registry.reset();
          expect(registry.isAgentDisabled('test')).toBe(false);
        }),
      );
    });
  });
});
