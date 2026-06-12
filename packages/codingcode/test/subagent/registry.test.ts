import { expect, it, describe, beforeEach } from 'vitest';
import {
  register,
  registerAll,
  get,
  list,
  reset,
  SubagentRegistry,
  EXPLORE_PROFILE,
  PLAN_PROFILE,
} from '../../src/subagent/registry';

describe('SubagentRegistry', () => {
  beforeEach(() => {
    reset();
  });

  it('should register and retrieve profiles', () => {
    const profile = {
      name: 'test-agent',
      description: 'Test agent',
      systemPrompt: 'You are a test agent',
    };

    register(profile);
    const retrieved = get('test-agent');

    expect(retrieved).toEqual(profile);
  });

  it('should list all registered profiles', () => {
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

    register(profile1);
    register(profile2);

    const all = list();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((p) => p.name === 'agent1')).toBe(true);
    expect(all.some((p) => p.name === 'agent2')).toBe(true);
  });

  it('should return undefined for unknown profile', () => {
    const result = get('unknown-agent');
    expect(result).toBeUndefined();
  });

  it('should support built-in explore profile', () => {
    expect(EXPLORE_PROFILE.name).toBe('explore');
    expect(EXPLORE_PROFILE.readonly).toBe(true);
    expect(EXPLORE_PROFILE.maxSteps).toBe(180);
    expect(EXPLORE_PROFILE.tools).toContain('read_file');
    expect(EXPLORE_PROFILE.tools).toContain('search_files');
    expect(EXPLORE_PROFILE.tools).toContain('search_code');
    expect(EXPLORE_PROFILE.tools).toContain('fetch_url');
    expect(EXPLORE_PROFILE.tools).toContain('tool_search');
  });

  it('explore profile systemPrompt includes guidelines', () => {
    expect(EXPLORE_PROFILE.systemPrompt).toContain('Start broad, then narrow down');
    expect(EXPLORE_PROFILE.systemPrompt).toContain('Call multiple tools in parallel');
    expect(EXPLORE_PROFILE.systemPrompt).toContain('file_path:line_number');
  });

  it('should support built-in plan profile', () => {
    expect(PLAN_PROFILE.name).toBe('plan');
    expect(PLAN_PROFILE.readonly).toBe(true);
    expect(PLAN_PROFILE.maxSteps).toBe(180);
    expect(PLAN_PROFILE.tools).toContain('read_file');
    expect(PLAN_PROFILE.tools).toContain('search_files');
    expect(PLAN_PROFILE.tools).toContain('search_code');
    expect(PLAN_PROFILE.tools).toContain('execute_command');
    expect(PLAN_PROFILE.tools).toContain('fetch_url');
    expect(PLAN_PROFILE.tools).toContain('tool_search');
  });

  it('plan profile systemPrompt includes research process and output format', () => {
    expect(PLAN_PROFILE.systemPrompt).toContain('Research process');
    expect(PLAN_PROFILE.systemPrompt).toContain('Output format');
    expect(PLAN_PROFILE.systemPrompt).toContain('Current state');
    expect(PLAN_PROFILE.systemPrompt).toContain('Key files');
    expect(PLAN_PROFILE.systemPrompt).toContain('Recommended approach');
  });

  it('should support profile with custom tools and maxSteps', () => {
    const profile = {
      name: 'custom',
      description: 'Custom agent',
      systemPrompt: 'Custom system',
      tools: ['tool1', 'tool2'],
      readonly: false,
      maxSteps: 15,
    };

    register(profile);
    const retrieved = get('custom');

    expect(retrieved?.tools).toContain('tool1');
    expect(retrieved?.maxSteps).toBe(15);
    expect(retrieved?.readonly).toBe(false);
  });

  it('should reset the registry', () => {
    register({
      name: 'temp',
      description: 'Temporary',
      systemPrompt: 'Temp system',
    });

    expect(get('temp')).toBeDefined();

    reset();

    expect(get('temp')).toBeUndefined();
  });

  it('static class methods delegate to module functions', () => {
    SubagentRegistry.register({ name: 'via-static', description: 'via static' });
    expect(SubagentRegistry.get('via-static')?.name).toBe('via-static');
    expect(SubagentRegistry.list().length).toBe(1);
    SubagentRegistry.reset();
    expect(SubagentRegistry.list().length).toBe(0);
  });
});
