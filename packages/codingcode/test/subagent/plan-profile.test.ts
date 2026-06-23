import { describe, it, expect } from 'vitest';
import { PLAN_PROFILE, BUILD_PROFILE, EXPLORE_PROFILE } from '../../src/subagent/registry.js';

describe('PLAN_PROFILE', () => {
  it('has name "plan"', () => {
    expect(PLAN_PROFILE.name).toBe('plan');
  });

  it('does NOT set a permissionMode (plan mode is enforced structurally by the plan-mode gate hook)', () => {
    // After the plan refactor, the approval pipeline no longer special-cases
    // a 'plan' PermissionMode. Plan mode is detected via `isPlanProfile(profile)`
    // and enforced by the `plan/planModeGateHook` registered on
    // `tool.approval.pre`. The profile intentionally has no `permissionMode`
    // field so the approval pipeline treats it like any other profile.
    expect(PLAN_PROFILE.permissionMode).toBeUndefined();
  });

  it('has maxSteps set to 180', () => {
    expect(PLAN_PROFILE.maxSteps).toBe(180);
  });

  it('has a systemPrompt', () => {
    expect(PLAN_PROFILE.systemPrompt).toBeTruthy();
    expect(PLAN_PROFILE.systemPrompt!.length).toBeGreaterThan(50);
  });

  it('excludes write tools (the plan-mode gate hook enforces this at approval time)', () => {
    const writeTools = ['write_file', 'edit_file', 'execute_command'];
    for (const wt of writeTools) {
      expect(PLAN_PROFILE.tools).not.toContain(wt);
    }
  });

  it('includes read_file and search_code', () => {
    expect(PLAN_PROFILE.tools).toContain('read_file');
    expect(PLAN_PROFILE.tools).toContain('search_code');
  });

  it('exposes submit_plan as the only allowed write in plan mode', () => {
    expect(PLAN_PROFILE.tools).toContain('submit_plan');
  });

  it('exposes dispatch_agent so the plan agent can delegate to explore', () => {
    expect(PLAN_PROFILE.tools).toContain('dispatch_agent');
  });

  it('has a distinct name from explore', () => {
    expect(PLAN_PROFILE.name).not.toBe(EXPLORE_PROFILE.name);
  });

  it('has description stating it is for planning', () => {
    expect(PLAN_PROFILE.description.toLowerCase()).toContain('plan');
  });
});

describe('BUILD_PROFILE', () => {
  it('has name "build"', () => {
    expect(BUILD_PROFILE.name).toBe('build');
  });

  it('uses the default permission mode (full read/write)', () => {
    expect(BUILD_PROFILE.permissionMode).toBe('default');
  });

  it('exposes write tools (write_file, edit_file, execute_command)', () => {
    expect(BUILD_PROFILE.tools).toContain('write_file');
    expect(BUILD_PROFILE.tools).toContain('edit_file');
    expect(BUILD_PROFILE.tools).toContain('execute_command');
  });

  it('does not expose submit_plan (build mode does not need it)', () => {
    expect(BUILD_PROFILE.tools).not.toContain('submit_plan');
  });
});
