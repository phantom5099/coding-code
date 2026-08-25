import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { planProfileGateHook, isSessionUsingPlanProfile } from '../../src/agent/profile.js';
import { computePaths } from '../../src/core/path.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function makeSessionIndex(cwd: string, sessionId: string, activeProfile: 'plan' | 'build') {
  const paths = computePaths(cwd, sessionId);
  mkdirSync(paths.transcriptPath.replace(/\.jsonl$/, ''), { recursive: true });
  const idx = {
    sessionId,
    cwd: paths.cwd,
    model: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    title: sessionId.slice(0, 8),
    currentTurnId: 0,
    usage: undefined,
    activeProfile,
    permissionMode: 'default',
  };
  writeFileSync(paths.indexPath, JSON.stringify(idx, null, 2), 'utf8');
  return paths;
}

describe('planProfileGateHook', () => {
  let cwd: string;
  let sessionId: string;

  beforeEach(() => {
    cwd = join(base.dir, 'gate');
    mkdirSync(cwd, { recursive: true });
    sessionId = 'sess-gate';
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns null when no sessionId is present', () => {
    expect(planProfileGateHook({ toolName: 'write_file' } as any)).toBeNull();
  });

  it('returns null when the session is not in plan profile', () => {
    makeSessionIndex(cwd, sessionId, 'build');
    expect(
      planProfileGateHook({ toolName: 'write_file', sessionId, projectPath: cwd } as any)
    ).toBeNull();
  });

  it('returns null when the tool is not provided', () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    expect(planProfileGateHook({ sessionId, projectPath: cwd } as any)).toBeNull();
  });

  it('allows submit_plan in plan profile', () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    expect(
      planProfileGateHook({ toolName: 'submit_plan', sessionId, projectPath: cwd } as any)
    ).toBeNull();
  });

  it('denies dispatch_agent in plan profile', () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    expect(
      planProfileGateHook({ toolName: 'dispatch_agent', sessionId, projectPath: cwd } as any)
    ).toMatchObject({ decision: 'deny' });
  });

  it('denies write_file in plan profile with the plan-profile reason', () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    const result = planProfileGateHook({
      toolName: 'write_file',
      sessionId,
      projectPath: cwd,
    } as any);
    expect(result).toEqual({
      decision: 'deny',
      reason: 'Write operations denied in plan profile. Use submit_plan to submit a plan.',
    });
  });

  it('denies execute_command in plan profile', async () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    const result = await planProfileGateHook({
      toolName: 'execute_command',
      sessionId,
      projectPath: cwd,
    } as any);
    expect(result?.decision).toBe('deny');
    expect(result?.reason).toMatch(/plan profile/i);
  });

  it('denies edit_file in plan profile', async () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    const result = await planProfileGateHook({
      toolName: 'edit_file',
      sessionId,
      projectPath: cwd,
    } as any);
    expect(result?.decision).toBe('deny');
  });
});

describe('isSessionUsingPlanProfile', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = join(base.dir, 'is-session-in-plan');
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns true when index has mode=plan', () => {
    makeSessionIndex(cwd, 's-plan', 'plan');
    expect(isSessionUsingPlanProfile('s-plan', cwd)).toBe(true);
  });

  it('returns false when index has mode=build', () => {
    makeSessionIndex(cwd, 's-build', 'build');
    expect(isSessionUsingPlanProfile('s-build', cwd)).toBe(false);
  });

  it('returns false when index file does not exist', () => {
    expect(isSessionUsingPlanProfile('s-missing', cwd)).toBe(false);
  });
});
