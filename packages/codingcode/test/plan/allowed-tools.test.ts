import { describe, it, expect } from 'vitest';
import {
  PLAN_PROFILE,
  BUILD_PROFILE,
  getToolNames,
  PLAN_TOOL_NAMES,
  BUILD_TOOL_NAMES,
} from '../../src/agent/profile.js';

describe('getToolNames (profile tool name list)', () => {
  it('plan profile includes submit_plan and excludes write tools', () => {
    const names = getToolNames(PLAN_PROFILE);
    expect(names).toContain('submit_plan');
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('execute_command');
  });

  it('build profile includes write tools and excludes submit_plan', () => {
    const names = getToolNames(BUILD_PROFILE);
    expect(names).toContain('write_file');
    expect(names).toContain('execute_command');
    expect(names).not.toContain('submit_plan');
  });

  it('undefined profile falls back to the build tool list', () => {
    expect(getToolNames(undefined)).toEqual(BUILD_TOOL_NAMES);
  });

  it('plan and build lists differ on the write/submit_plan axis', () => {
    expect(PLAN_TOOL_NAMES).not.toContain('write_file');
    expect(BUILD_TOOL_NAMES).not.toContain('submit_plan');
  });
});
