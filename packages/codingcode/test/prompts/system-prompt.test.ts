import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, SYSTEM_NOTES } from '../../src/agent/prompt.js';

const baseOpts = { cwd: '/test', platform: 'linux', shell: 'bash' };

describe('buildSystemPrompt', () => {
  it('replaces cwd, platform, shell placeholders', () => {
    const prompt = buildSystemPrompt({ cwd: '/my/proj', platform: 'darwin', shell: 'zsh' });
    expect(prompt).toContain('/my/proj');
    expect(prompt).toContain('darwin');
    expect(prompt).toContain('zsh');
  });

  it('includes identity definition', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('coding assistant');
    expect(prompt).toContain('software engineering tasks');
  });

  it('includes How you work section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('How you work');
    expect(prompt).toContain('permission system');
    expect(prompt).toContain('system-reminder');
  });

  it('Rule 7 guides assessment-first then optional delegation', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('assess the task scope');
    expect(prompt).toContain('dispatch_agent');
  });

  it('includes Using your tools section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Using your tools');
    expect(prompt).toContain('Prefer dedicated tools over shell commands');
    expect(prompt).toContain('Call multiple tools in parallel');
    expect(prompt).toContain('read_file instead of cat');
  });

  it('includes Executing actions with care section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Executing actions with care');
    expect(prompt).toContain('reversibility and blast radius');
    expect(prompt).toContain('destructive commands');
    expect(prompt).toContain('rm -rf');
  });

  it('includes Git operations section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Git operations');
    expect(prompt).toContain('Do NOT commit changes unless the user explicitly asks');
    expect(prompt).toContain('git reset --hard');
    expect(prompt).toContain('git push --force');
  });

  it('includes Professional objectivity section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Professional objectivity');
    expect(prompt).toContain('technical accuracy');
    expect(prompt).toContain('Do not begin responses with conversational interjections');
  });

  it('includes Follow existing conventions section with expanded guidance', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Follow existing conventions');
    expect(prompt).toContain('Never assume a library is available');
    expect(prompt).toContain('package.json');
    expect(prompt).toContain('Comments');
    expect(prompt).toContain('WHY is non-obvious');
  });

  it('includes Code references section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Code references');
    expect(prompt).toContain('file_path:line_number');
  });

  it('includes Output efficiency section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Output efficiency');
    expect(prompt).toContain('Lead with the answer');
    expect(prompt).toContain('one-to-two sentence summary');
    expect(prompt).toContain('Match the response to the question');
  });

  it('SYSTEM_NOTES explains compression, memory, and todo', () => {
    expect(SYSTEM_NOTES).toContain('automatically compressed');
    expect(SYSTEM_NOTES).toContain('Session Memory');
    expect(SYSTEM_NOTES).toContain('todo_write');
  });

  it('includes SYSTEM_NOTES in prompt', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('System Notes');
    expect(prompt).toContain('automatically compressed');
  });

  it('includes user-defined rules section when rules exist', () => {
    const prompt = buildSystemPrompt({ ...baseOpts, rules: 'Always use TypeScript strict mode' });
    expect(prompt).toContain('User-defined Rules');
    expect(prompt).toContain('Always use TypeScript strict mode');
  });

  it('omits user-defined rules section when rules is undefined', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).not.toContain('User-defined Rules');
  });

  it('includes available subagents section when profiles are provided', () => {
    const profiles = [
      {
        name: 'explore',
        description: 'Read-only code exploration.',
        tools: ['read_file'],
        disabled: false,
      },
    ];
    const prompt = buildSystemPrompt({ ...baseOpts, agentProfiles: profiles });
    expect(prompt).toContain('Available Subagents');
    expect(prompt).toContain('dispatch_agent');
    expect(prompt).toContain('explore');
    expect(prompt).toContain('Read-only code exploration.');
  });

  it('includes plan subagent in available subagents when provided', () => {
    const profiles = [
      { name: 'explore', description: 'Explore.', tools: ['read_file'], disabled: false },
      {
        name: 'plan',
        description: 'Codebase research for planning.',
        tools: ['read_file', 'search_code'],
        disabled: false,
      },
    ];
    const prompt = buildSystemPrompt({ ...baseOpts, agentProfiles: profiles });
    expect(prompt).toContain('plan');
    expect(prompt).toContain('Codebase research for planning');
    expect(prompt).toContain('dispatch_agent');
  });

  it('omits available subagents section when no profiles are provided', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).not.toContain('Available Subagents');
  });

  it('does not contain old Rule 3 (verify with read_file after writing)', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).not.toContain('verify with read_file');
  });

  it('does not contain DEFERRED_TOOLS_GUIDELINES as separate section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).not.toContain('Deferred tools');
  });
});
