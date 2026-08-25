import { describe, expect, it } from 'vitest';
import { PLAN_PROFILE_ALLOWED_TOOLS } from '../../src/agent/profile.js';

describe('PLAN_PROFILE_ALLOWED_TOOLS', () => {
  it('contains only read tools and submit_plan', () => {
    expect(PLAN_PROFILE_ALLOWED_TOOLS).toEqual(
      new Set(['read_file', 'search_files', 'search_code', 'fetch_url', 'submit_plan'])
    );
  });

  it('does not expose write tools', () => {
    expect(PLAN_PROFILE_ALLOWED_TOOLS.has('write_file')).toBe(false);
    expect(PLAN_PROFILE_ALLOWED_TOOLS.has('edit_file')).toBe(false);
    expect(PLAN_PROFILE_ALLOWED_TOOLS.has('execute_command')).toBe(false);
  });
});
