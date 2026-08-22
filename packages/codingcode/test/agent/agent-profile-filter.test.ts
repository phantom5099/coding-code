import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../src/agent/prompt.js';

describe('system prompt', () => {
  it('does not advertise a subagent catalog', () => {
    const prompt = buildSystemPrompt({
      cwd: '/x',
      platform: 'linux',
      shell: 'bash',
    });
    expect(prompt).not.toContain('Available Subagents');
  });
});
