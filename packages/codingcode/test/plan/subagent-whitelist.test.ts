import { describe, it, expect } from 'vitest';
import { checkSubagentAllowedInPlanMode } from '../../src/plan/index.js';

describe('checkSubagentAllowedInPlanMode', () => {
  it('returns allowed when no parentSessionId is present (top-level dispatch is not in scope)', () => {
    const result = checkSubagentAllowedInPlanMode(undefined, 'plan', 'build');
    expect(result).toEqual({ allowed: true });
  });

  it('returns allowed when the parent main profile is not "plan"', () => {
    const result = checkSubagentAllowedInPlanMode('parent-sess', 'build', 'build');
    expect(result).toEqual({ allowed: true });
  });

  it('returns allowed when the parent main profile is missing', () => {
    const result = checkSubagentAllowedInPlanMode('parent-sess', undefined, 'build');
    expect(result).toEqual({ allowed: true });
  });

  it('allows dispatching the explore subagent in plan mode', () => {
    const result = checkSubagentAllowedInPlanMode('parent-sess', 'plan', 'explore');
    expect(result).toEqual({ allowed: true });
  });

  it('denies dispatching any non-explore subagent in plan mode', () => {
    const result = checkSubagentAllowedInPlanMode('parent-sess', 'plan', 'build');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/Plan mode can only dispatch the 'explore' subagent/);
      expect(result.reason).toContain("'build'");
    }
  });

  it('denies a custom user-defined agent name in plan mode', () => {
    const result = checkSubagentAllowedInPlanMode('parent-sess', 'plan', 'my-custom-agent');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("'my-custom-agent'");
    }
  });

  it('returns allowed when no profile is provided (defensive — let other layers handle)', () => {
    const result = checkSubagentAllowedInPlanMode('parent-sess', 'plan', undefined);
    expect(result).toEqual({ allowed: true });
  });
});
