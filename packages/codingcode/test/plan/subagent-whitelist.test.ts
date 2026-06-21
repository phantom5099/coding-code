import { describe, it, expect } from 'vitest';
import { planSubagentWhitelistHook } from '../../src/plan/index.js';

describe('planSubagentWhitelistHook', () => {
  it('returns null when no parentSessionId is present (top-level dispatch is not in scope)', () => {
    const result = planSubagentWhitelistHook({
      profile: 'build',
      parentSessionId: undefined,
      parentMainProfile: 'plan',
    } as any);
    expect(result).toBeNull();
  });

  it('returns null when the parent main profile is not "plan"', () => {
    const result = planSubagentWhitelistHook({
      profile: 'build',
      parentSessionId: 'parent-sess',
      parentMainProfile: 'build',
    } as any);
    expect(result).toBeNull();
  });

  it('returns null when the parent main profile is missing', () => {
    const result = planSubagentWhitelistHook({
      profile: 'build',
      parentSessionId: 'parent-sess',
    } as any);
    expect(result).toBeNull();
  });

  it('allows dispatching the explore subagent in plan mode', () => {
    const result = planSubagentWhitelistHook({
      profile: 'explore',
      parentSessionId: 'parent-sess',
      parentMainProfile: 'plan',
    } as any);
    expect(result).toBeNull();
  });

  it('denies dispatching any non-explore subagent in plan mode', () => {
    const result = planSubagentWhitelistHook({
      profile: 'build',
      parentSessionId: 'parent-sess',
      parentMainProfile: 'plan',
    } as any);
    expect(result).toEqual({
      decision: 'deny',
      reason: expect.stringMatching(/Plan mode can only dispatch the 'explore' subagent/),
    });
    expect(result?.reason).toContain("'build'");
  });

  it('denies a custom user-defined agent name in plan mode', () => {
    const result = planSubagentWhitelistHook({
      profile: 'my-custom-agent',
      parentSessionId: 'parent-sess',
      parentMainProfile: 'plan',
    } as any);
    expect(result?.decision).toBe('deny');
    expect(result?.reason).toContain("'my-custom-agent'");
  });

  it('returns null when no profile is provided (defensive — let other layers handle)', () => {
    const result = planSubagentWhitelistHook({
      profile: undefined,
      parentSessionId: 'parent-sess',
      parentMainProfile: 'plan',
    } as any);
    expect(result).toBeNull();
  });
});
