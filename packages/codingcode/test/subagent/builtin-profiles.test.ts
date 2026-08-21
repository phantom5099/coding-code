import { describe, expect, it } from 'vitest';
import { PLAN_PROFILE, BUILD_PROFILE } from '../../src/subagent/registry.js';
import { PLAN_MODE_ALLOWED_TOOLS } from '../../src/plan/index.js';

describe('built-in subagent profiles', () => {
  it('keeps only build and plan as built-in names', () => {
    expect([BUILD_PROFILE.name, PLAN_PROFILE.name].sort()).toEqual(['build', 'plan']);
  });

  it('keeps plan tools independent from profile tool lists', () => {
    expect('tools' in PLAN_PROFILE).toBe(false);
    expect('tools' in BUILD_PROFILE).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS).toEqual(
      new Set(['read_file', 'search_files', 'search_code', 'fetch_url', 'submit_plan'])
    );
  });
});
