import { describe, it, expect, beforeEach } from 'vitest';
import {
  markSessionPlanMode,
  isSessionInPlanMode,
  clearPlanModeSession,
} from '../../src/plan/active-sessions.js';

describe('plan/active-sessions side channel', () => {
  beforeEach(() => {
    // Clear any leftover state between tests
    clearPlanModeSession('s1');
    clearPlanModeSession('s2');
  });

  it('starts as false for an unmarked session', () => {
    expect(isSessionInPlanMode('s1')).toBe(false);
  });

  it('markSessionPlanMode(id, true) marks the session as plan mode', () => {
    markSessionPlanMode('s1', true);
    expect(isSessionInPlanMode('s1')).toBe(true);
  });

  it('markSessionPlanMode(id, false) unmarks a previously plan-mode session', () => {
    markSessionPlanMode('s1', true);
    markSessionPlanMode('s1', false);
    expect(isSessionInPlanMode('s1')).toBe(false);
  });

  it('clearPlanModeSession always removes the session', () => {
    markSessionPlanMode('s1', true);
    clearPlanModeSession('s1');
    expect(isSessionInPlanMode('s1')).toBe(false);
  });

  it('is per-session: marking s1 does not affect s2', () => {
    markSessionPlanMode('s1', true);
    expect(isSessionInPlanMode('s1')).toBe(true);
    expect(isSessionInPlanMode('s2')).toBe(false);
  });
});
