import { describe, it, expect } from 'vitest';
import { isPlanProfile } from '../../src/session/types.js';

describe('isPlanProfile', () => {
  it('returns true for "plan"', () => {
    expect(isPlanProfile('plan')).toBe(true);
  });

  it('returns false for "build"', () => {
    expect(isPlanProfile('build')).toBe(false);
  });

  it('returns false for an arbitrary profile name', () => {
    expect(isPlanProfile('custom')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isPlanProfile(null)).toBe(false);
    expect(isPlanProfile(undefined)).toBe(false);
  });
});
