import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, DEFERRED_TOOLS_GUIDELINES } from '../../src/agent/prompt.js';

const baseOpts = { cwd: '/test', platform: 'linux', shell: 'bash' };

describe('buildSystemPrompt', () => {
  it('default variant includes deferred tools guidelines', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('tool_search');
  });

  it('minimal variant excludes deferred tools guidelines', () => {
    const prompt = buildSystemPrompt({ ...baseOpts, variant: 'minimal' });
    expect(prompt).not.toContain('tool_search');
  });

  it('replaces cwd, platform, shell placeholders', () => {
    const prompt = buildSystemPrompt({ cwd: '/my/proj', platform: 'darwin', shell: 'zsh' });
    expect(prompt).toContain('/my/proj');
    expect(prompt).toContain('darwin');
    expect(prompt).toContain('zsh');
  });

  it('includes dispatch_agent delegation rule for complex tasks', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('dispatch_agent');
    expect(prompt).toContain('do not explore the topic yourself before delegating');
  });

  it('DEFERRED_TOOLS_GUIDELINES is a non-empty string', () => {
    expect(DEFERRED_TOOLS_GUIDELINES.length).toBeGreaterThan(0);
    expect(DEFERRED_TOOLS_GUIDELINES).toContain('tool_search');
  });
});
