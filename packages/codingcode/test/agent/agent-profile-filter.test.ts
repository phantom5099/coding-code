import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/agent/prompt.js';
import { PLAN_PROFILE, BUILD_PROFILE, EXPLORE_PROFILE } from '../../src/subagent/registry.js';

describe('agent profile catalog filter', () => {
  it('plan mode shows only explore in the catalog', () => {
    const allProfiles = [BUILD_PROFILE, PLAN_PROFILE, EXPLORE_PROFILE];
    const visible = allProfiles.filter((p) => p.name === 'explore');
    const prompt = buildSystemPrompt({
      cwd: '/x',
      platform: 'linux',
      shell: 'bash',
      agentProfiles: visible,
    });
    expect(prompt).toContain('### explore');
    expect(prompt).not.toContain('### build');
    expect(prompt).not.toContain('### plan');
  });

  it('build mode shows all profiles in the catalog', () => {
    const allProfiles = [BUILD_PROFILE, PLAN_PROFILE, EXPLORE_PROFILE];
    const prompt = buildSystemPrompt({
      cwd: '/x',
      platform: 'linux',
      shell: 'bash',
      agentProfiles: allProfiles,
    });
    expect(prompt).toContain('### build');
    expect(prompt).toContain('### plan');
    expect(prompt).toContain('### explore');
  });

  it('empty catalog produces no ## Available Subagents section', () => {
    const prompt = buildSystemPrompt({
      cwd: '/x',
      platform: 'linux',
      shell: 'bash',
      agentProfiles: [],
    });
    expect(prompt).not.toContain('## Available Subagents');
  });
});
