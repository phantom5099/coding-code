import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, TASK_TRACKING_GUIDELINES } from '../../src/prompts/index.js';

const baseOpts = { cwd: '/test', platform: 'linux', shell: 'bash' };

describe('buildSystemPrompt', () => {
  it('default variant includes task tracking guidelines', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('todo_write');
    expect(prompt).toContain('tool_search');
  });

  it('includeTaskTracking: false excludes guidelines', () => {
    const prompt = buildSystemPrompt({ ...baseOpts, includeTaskTracking: false });
    expect(prompt).not.toContain('todo_write');
  });

  it('minimal variant excludes tracking by default', () => {
    const prompt = buildSystemPrompt({ ...baseOpts, variant: 'minimal' });
    expect(prompt).not.toContain('TASK_TRACKING_GUIDELINES');
  });

  it('minimal variant with includeTaskTracking: true includes it', () => {
    const prompt = buildSystemPrompt({ ...baseOpts, variant: 'minimal', includeTaskTracking: true });
    expect(prompt).toContain('todo_write');
  });

  it('replaces cwd, platform, shell placeholders', () => {
    const prompt = buildSystemPrompt({ cwd: '/my/proj', platform: 'darwin', shell: 'zsh' });
    expect(prompt).toContain('/my/proj');
    expect(prompt).toContain('darwin');
    expect(prompt).toContain('zsh');
  });

  it('TASK_TRACKING_GUIDELINES is a non-empty string', () => {
    expect(TASK_TRACKING_GUIDELINES.length).toBeGreaterThan(0);
    expect(TASK_TRACKING_GUIDELINES).toContain('todo_write');
  });
});
