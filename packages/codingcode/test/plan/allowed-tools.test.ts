import { describe, it, expect } from 'vitest';
import {
  PLAN_PROFILE,
  BUILD_PROFILE,
  getAllowedTools,
} from '../../src/agent/profile.js';

describe('getAllowedTools (profile pure function)', () => {
  it('returns the plan allowlist for a plan profile', () => {
    const allowed = getAllowedTools(PLAN_PROFILE);
    expect(allowed).toBeDefined();
    expect(allowed!.has('read_file')).toBe(true);
    expect(allowed!.has('submit_plan')).toBe(true);
    expect(allowed!.has('write_file')).toBe(false);
    expect(allowed!.has('execute_command')).toBe(false);
  });

  it('returns undefined for build and undefined profiles', () => {
    expect(getAllowedTools(BUILD_PROFILE)).toBeUndefined();
    expect(getAllowedTools(undefined)).toBeUndefined();
  });
});
