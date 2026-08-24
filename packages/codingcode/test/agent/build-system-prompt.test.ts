import { describe, it, expect } from 'vitest';
import { BUILD_PROMPT, PLAN_PROMPT, buildSystemPrompt } from '../../src/agent/prompt.js';
import { PLAN_PROFILE } from '../../src/agent/mode.js';

describe('buildSystemPrompt', () => {
  it('uses the build prompt when profileSystemPrompt is not provided', () => {
    const prompt = buildSystemPrompt({
      cwd: '/test',
      platform: 'linux',
      shell: 'bash',
    });
    expect(prompt).toContain(BUILD_PROMPT);
    expect(prompt).toContain('## How you work');
    expect(prompt).toContain('## Environment');
    expect(prompt).toContain('Working directory: /test');
  });

  it('uses the plan prompt when profileSystemPrompt is provided', () => {
    const prompt = buildSystemPrompt({
      cwd: '/test',
      platform: 'linux',
      shell: 'bash',
      profileSystemPrompt: PLAN_PROMPT,
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

  it('plan profile prompt limits implementation work to submit_plan', () => {
    const prompt = buildSystemPrompt({
      cwd: '/x',
      platform: 'linux',
      shell: 'bash',
      profileSystemPrompt: PLAN_PROFILE.systemPrompt,
    });
    expect(prompt).toContain('submit_plan');
    expect(prompt).toContain('write_file / edit_file / execute_command are denied');
  });
});
