import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/agent/prompt.js';
import { PLAN_PROFILE, BUILD_PROFILE } from '../../src/subagent/registry.js';

describe('buildSystemPrompt', () => {
  it('uses DEFAULT_BEHAVIOR_PROMPT when profileSystemPrompt is not provided', () => {
    const prompt = buildSystemPrompt({
      cwd: '/test',
      platform: 'linux',
      shell: 'bash',
    });
    expect(prompt).toContain('You are a coding assistant');
    expect(prompt).toContain('## How you work');
    expect(prompt).toContain('## Environment');
    expect(prompt).toContain('Working directory: /test');
  });

  it('overrides default behavior with profileSystemPrompt when provided (plan mode)', () => {
    const prompt = buildSystemPrompt({
      cwd: '/test',
      platform: 'linux',
      shell: 'bash',
      profileSystemPrompt: PLAN_PROFILE.systemPrompt,
    });
    expect(prompt).toContain('You are a planning agent');
    expect(prompt).toContain('## Environment');
    expect(prompt).toContain('Working directory: /test');
    expect(prompt).not.toContain('You are a coding assistant');
    expect(prompt).not.toContain('## How you work');
  });

  it('emits env segment with cwd/platform/shell replaced', () => {
    const prompt = buildSystemPrompt({
      cwd: '/projects/foo',
      platform: 'darwin',
      shell: 'zsh',
    });
    expect(prompt).toContain('Working directory: /projects/foo');
    expect(prompt).toContain('Operating system: darwin');
    expect(prompt).toContain('Shell: zsh');
    expect(prompt).not.toContain('{{cwd}}');
    expect(prompt).not.toContain('{{platform}}');
    expect(prompt).not.toContain('{{shell}}');
  });

  it('appends agent catalog when agentProfiles is provided', () => {
    const prompt = buildSystemPrompt({
      cwd: '/x',
      platform: 'linux',
      shell: 'bash',
      agentProfiles: [BUILD_PROFILE, PLAN_PROFILE],
    });
    expect(prompt).toContain('## Available Subagents');
    expect(prompt).toContain('### build');
    expect(prompt).toContain('### plan');
  });

  it('appends user-defined rules when provided', () => {
    const prompt = buildSystemPrompt({
      cwd: '/x',
      platform: 'linux',
      shell: 'bash',
      rules: 'Always use TypeScript strict mode.',
    });
    expect(prompt).toContain('## User-defined Rules');
    expect(prompt).toContain('Always use TypeScript strict mode.');
  });

  it('appends skill instructions when provided', () => {
    const prompt = buildSystemPrompt({
      cwd: '/x',
      platform: 'linux',
      shell: 'bash',
      skillInstruction: 'When reviewing code, focus on security.',
    });
    expect(prompt).toContain('## Skill Instructions');
    expect(prompt).toContain('When reviewing code, focus on security.');
  });

  it('plan profile prompt mentions submit_plan and dispatch_agent for explore only', () => {
    const prompt = buildSystemPrompt({
      cwd: '/x',
      platform: 'linux',
      shell: 'bash',
      profileSystemPrompt: PLAN_PROFILE.systemPrompt,
    });
    expect(prompt).toContain('submit_plan');
    expect(prompt).toContain("dispatch the 'explore' subagent");
    expect(prompt).toContain('write_file / edit_file / execute_command are denied');
  });
});
