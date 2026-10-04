import { describe, it, expect } from 'vitest';
import { isPlanProfile } from '../../src/agent/profile.js';

describe('isPlanProfile', () => {
  it('returns true for a profile named "plan"', () => {
    expect(isPlanProfile({ name: 'plan' })).toBe(true);
  });

  it('returns false for "build"', () => {
    expect(isPlanProfile({ name: 'build' })).toBe(false);
  });

  it('returns false for an arbitrary profile name', () => {
    expect(isPlanProfile({ name: 'custom' })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isPlanProfile(null)).toBe(false);
    expect(isPlanProfile(undefined)).toBe(false);
  });

});
