import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { planModeGateHook, isSessionInPlanMode } from '../../src/plan/index.js';
import { computePaths } from '../../src/core/path.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function makeSessionIndex(cwd: string, sessionId: string, mode: 'plan' | 'build') {
  const paths = computePaths(cwd, sessionId);
  mkdirSync(paths.transcriptPath.replace(/\.jsonl$/, ''), { recursive: true });
  const idx = {
    sessionId,
    projectPath: paths.projectPath,
    cwd: paths.cwd,
    model: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    title: sessionId.slice(0, 8),
    currentTurnId: 0,
    usage: undefined,
    mode,
    permissionMode: 'default',
  };
  writeFileSync(paths.indexPath, JSON.stringify(idx, null, 2), 'utf8');
  return paths;
}

describe('planModeGateHook', () => {
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
    expect(planModeGateHook({ toolName: 'write_file' } as any)).toBeNull();
  });

  it('returns null when the session is not in plan mode', () => {
    makeSessionIndex(cwd, sessionId, 'build');
    expect(
      planModeGateHook({ toolName: 'write_file', sessionId, projectPath: cwd } as any)
    ).toBeNull();
  });

  it('returns null when the tool is not provided', () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    expect(planModeGateHook({ sessionId, projectPath: cwd } as any)).toBeNull();
  });

  it('allows submit_plan in plan mode', () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    expect(
      planModeGateHook({ toolName: 'submit_plan', sessionId, projectPath: cwd } as any)
    ).toBeNull();
  });

  it('allows dispatch_agent in plan mode', () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    expect(
      planModeGateHook({ toolName: 'dispatch_agent', sessionId, projectPath: cwd } as any)
    ).toBeNull();
  });

  it('denies write_file in plan mode with the plan-mode reason', () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    const result = planModeGateHook({
      toolName: 'write_file',
      sessionId,
      projectPath: cwd,
    } as any);
    expect(result).toEqual({
      decision: 'deny',
      reason: 'Write operations denied in plan mode. Use submit_plan to submit a plan.',
    });
  });

  it('denies execute_command in plan mode', async () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    const result = await planModeGateHook({
      toolName: 'execute_command',
      sessionId,
      projectPath: cwd,
    } as any);
    expect(result?.decision).toBe('deny');
    expect(result?.reason).toMatch(/plan mode/i);
  });

  it('denies edit_file in plan mode', async () => {
    makeSessionIndex(cwd, sessionId, 'plan');
    const result = await planModeGateHook({
      toolName: 'edit_file',
      sessionId,
      projectPath: cwd,
    } as any);
    expect(result?.decision).toBe('deny');
  });
});

describe('isSessionInPlanMode', () => {
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
    expect(isSessionInPlanMode('s-plan', cwd)).toBe(true);
  });

  it('returns false when index has mode=build', () => {
    makeSessionIndex(cwd, 's-build', 'build');
    expect(isSessionInPlanMode('s-build', cwd)).toBe(false);
  });

  it('returns false when index file does not exist', () => {
    expect(isSessionInPlanMode('s-missing', cwd)).toBe(false);
  });
});
