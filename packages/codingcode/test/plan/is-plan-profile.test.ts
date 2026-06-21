import { describe, it, expect } from 'vitest';
import {
  isPlanProfile,
  PLAN_PROFILE_NAME,
  BUILD_PROFILE_NAME,
  EXPLORE_PROFILE_NAME,
} from '../../src/plan/is-plan-profile.js';

describe('isPlanProfile', () => {
  it('returns true for a profile named "plan"', () => {
    expect(isPlanProfile({ name: 'plan' })).toBe(true);
  });

  it('returns false for "build"', () => {
    expect(isPlanProfile({ name: 'build' })).toBe(false);
  });

  it('returns false for "explore"', () => {
    expect(isPlanProfile({ name: 'explore' })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isPlanProfile(null)).toBe(false);
    expect(isPlanProfile(undefined)).toBe(false);
  });

  it('exposes the canonical profile name constants', () => {
    expect(PLAN_PROFILE_NAME).toBe('plan');
    expect(BUILD_PROFILE_NAME).toBe('build');
    expect(EXPLORE_PROFILE_NAME).toBe('explore');
  });
});
