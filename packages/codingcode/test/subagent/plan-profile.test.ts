import { describe, it, expect } from 'vitest';
import { PLAN_PROFILE, EXPLORE_PROFILE } from '../../src/subagent/registry.js';

describe('PLAN_PROFILE', () => {
  it('has name "plan"', () => {
    expect(PLAN_PROFILE.name).toBe('plan');
  });

  it('is readonly', () => {
    expect(PLAN_PROFILE.readonly).toBe(true);
  });

  it('has maxSteps set to 180', () => {
    expect(PLAN_PROFILE.maxSteps).toBe(180);
  });

  it('has a systemPrompt', () => {
    expect(PLAN_PROFILE.systemPrompt).toBeTruthy();
    expect(PLAN_PROFILE.systemPrompt!.length).toBeGreaterThan(50);
  });

  it('only includes read-only tools', () => {
    const writeTools = ['write_file', 'edit_file'];
    for (const wt of writeTools) {
      expect(PLAN_PROFILE.tools).not.toContain(wt);
    }
  });

  it('includes read_file and search_code', () => {
    expect(PLAN_PROFILE.tools).toContain('read_file');
    expect(PLAN_PROFILE.tools).toContain('search_code');
  });

  it('includes execute_command for build checks', () => {
    expect(PLAN_PROFILE.tools).toContain('execute_command');
  });

  it('has a distinct name from explore', () => {
    expect(PLAN_PROFILE.name).not.toBe(EXPLORE_PROFILE.name);
  });

  it('has description stating it is for planning', () => {
    expect(PLAN_PROFILE.description.toLowerCase()).toContain('plan');
  });
});
