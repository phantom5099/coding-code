import { describe, it, expect } from 'vitest';
import { PLAN_MODE_ALLOWED_TOOLS } from '../../src/plan/policy.js';

describe('PLAN_MODE_ALLOWED_TOOLS', () => {
  it('contains submit_plan', () => {
    expect(PLAN_MODE_ALLOWED_TOOLS.has('submit_plan')).toBe(true);
  });

  it('contains dispatch_agent (further restricted by subagent-whitelist hook)', () => {
    expect(PLAN_MODE_ALLOWED_TOOLS.has('dispatch_agent')).toBe(true);
  });

  it('does NOT contain write tools', () => {
    expect(PLAN_MODE_ALLOWED_TOOLS.has('write_file')).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS.has('edit_file')).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS.has('execute_command')).toBe(false);
  });

  it('does NOT contain read tools (they reach the pipeline as readonly whitelist, not as plan-mode bypass)', () => {
    // Read-only tools are handled by Layer 2 of the approval pipeline, not by
    // the plan-mode gate. The gate is a deny-list for non-allowed writes; it
    // only short-circuits tools that *would* fail the gate.
    expect(PLAN_MODE_ALLOWED_TOOLS.has('read_file')).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS.has('search_files')).toBe(false);
  });
});
