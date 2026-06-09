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

  it('Rule 8 guides assessment-first then optional delegation', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('assess the task scope');
  });

  it('includes professional objectivity section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Professional objectivity');
    expect(prompt).toContain('technical accuracy');
    expect(prompt).toContain('Do not begin responses with conversational interjections');
  });

  it('includes code references section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Code references');
    expect(prompt).toContain('file_path:line_number');
  });

  it('includes follow existing conventions section', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('Follow existing conventions');
    expect(prompt).toContain('Never assume a library is available');
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
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).toContain('User-defined Rules');
  });

  it('includes available subagents section when profiles are provided', () => {
    const profiles = [{ name: 'explore', description: 'Read-only code exploration.', tools: ['read_file'], disabled: false }];
    const prompt = buildSystemPrompt({ ...baseOpts, agentProfiles: profiles });
    expect(prompt).toContain('Available Subagents');
    expect(prompt).toContain('dispatch_agent');
    expect(prompt).toContain('explore');
    expect(prompt).toContain('Read-only code exploration.');
  });

  it('includes plan subagent in available subagents when provided', () => {
    const profiles = [
      { name: 'explore', description: 'Explore.', tools: ['read_file'], disabled: false },
      { name: 'plan', description: 'Codebase research for planning.', tools: ['read_file', 'search_code'], disabled: false },
    ];
    const prompt = buildSystemPrompt({ ...baseOpts, agentProfiles: profiles });
    expect(prompt).toContain('plan');
    expect(prompt).toContain('Codebase research for planning');
    expect(prompt).toContain('dispatch_agent');
  });

  it('SYSTEM_NOTES guides using plan subagent for complex tasks', () => {
    expect(SYSTEM_NOTES).toContain('plan');
    expect(SYSTEM_NOTES).toContain('dispatch_agent');
    expect(SYSTEM_NOTES).toContain('complex tasks');
  });

  it('omits available subagents section when no profiles are provided', () => {
    const prompt = buildSystemPrompt(baseOpts);
    expect(prompt).not.toContain('Available Subagents');
  });
});
