import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  planModeGateHook,
  markSessionPlanMode,
  clearPlanModeSession,
} from '../../src/plan/index.js';

describe('planModeGateHook', () => {
  beforeEach(() => {
    clearPlanModeSession('sess');
  });

  afterEach(() => {
    clearPlanModeSession('sess');
  });

  it('returns null when no sessionId is present', () => {
    expect(planModeGateHook({ toolName: 'write_file' } as any)).toBeNull();
  });

  it('returns null when the session is not in plan mode', () => {
    expect(planModeGateHook({ toolName: 'write_file', sessionId: 'sess' } as any)).toBeNull();
  });

  it('returns null when the tool is not provided', () => {
    markSessionPlanMode('sess', true);
    expect(planModeGateHook({ sessionId: 'sess' } as any)).toBeNull();
  });

  it('allows submit_plan in plan mode', () => {
    markSessionPlanMode('sess', true);
    expect(planModeGateHook({ toolName: 'submit_plan', sessionId: 'sess' } as any)).toBeNull();
  });

  it('allows dispatch_agent in plan mode (subagent-whitelist hook further restricts)', () => {
    markSessionPlanMode('sess', true);
    expect(planModeGateHook({ toolName: 'dispatch_agent', sessionId: 'sess' } as any)).toBeNull();
  });

  it('denies write_file in plan mode with the plan-mode reason', () => {
    markSessionPlanMode('sess', true);
    const result = planModeGateHook({
      toolName: 'write_file',
      sessionId: 'sess',
    } as any);
    expect(result).toEqual({
      decision: 'deny',
      reason: 'Write operations denied in plan mode. Use submit_plan to submit a plan.',
    });
  });

  it('denies execute_command in plan mode', async () => {
    markSessionPlanMode('sess', true);
    const result = await planModeGateHook({
      toolName: 'execute_command',
      sessionId: 'sess',
    } as any);
    expect(result?.decision).toBe('deny');
    expect(result?.reason).toMatch(/plan mode/i);
  });

  it('denies edit_file in plan mode', async () => {
    markSessionPlanMode('sess', true);
    const result = await planModeGateHook({
      toolName: 'edit_file',
      sessionId: 'sess',
    } as any);
    expect(result?.decision).toBe('deny');
  });
});
