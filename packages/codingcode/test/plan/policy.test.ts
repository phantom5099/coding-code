import { describe, expect, it } from 'vitest';
import { PLAN_ALLOWED_TOOLS } from '../../src/approval/tool-policy.js';

describe('PLAN_ALLOWED_TOOLS', () => {
  it('does not expose write tools', () => {
    expect(PLAN_ALLOWED_TOOLS.has('write_file')).toBe(false);
    expect(PLAN_ALLOWED_TOOLS.has('edit_file')).toBe(false);
    expect(PLAN_ALLOWED_TOOLS.has('execute_command')).toBe(false);
  });
});
