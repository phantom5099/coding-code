import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadHookConfigs,
  writeHookConfigs,
  loadGlobalHookConfigs,
  writeGlobalHookConfigs,
  resolveHookConfigs,
  getGlobalHookDisabledState,
  setGlobalHookDisabledState,
  getProjectHookDisabledState,
  setProjectHookDisabledState,
  resetProjectHookDisabledState,
  resolveHookDisabled,
  _setGlobalConfigDir,
} from '../../src/hooks/config.js';

let projectDir: string;
let globalDir: string;

describe('Hooks config merge', () => {
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'codingcode-test-hooks-merge-project-'));
    globalDir = mkdtempSync(join(tmpdir(), 'codingcode-test-hooks-merge-global-'));
    mkdirSync(join(projectDir, '.codingcode'), { recursive: true });
    mkdirSync(join(globalDir, '.codingcode'), { recursive: true });
    _setGlobalConfigDir(globalDir);
  });

  afterEach(() => {
    _setGlobalConfigDir(undefined);
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  });

  it('should merge global and project hooks, project overrides global', () => {
    // Write global hooks
    const globalHooks = [
      {
        name: 'global-hook',
        point: 'tool.execute.before' as const,
        type: 'observer' as const,
        command: 'global-cmd',
        enabled: true,
      },
      {
        name: 'shared-hook',
        point: 'tool.execute.after' as const,
        type: 'observer' as const,
        command: 'global-shared-cmd',
        enabled: true,
      },
    ];
    writeGlobalHookConfigs(globalHooks);

    // Write project hooks
    const projectHooks = [
      {
        name: 'shared-hook',
        point: 'tool.execute.after' as const,
        type: 'observer' as const,
        command: 'project-shared-cmd',
        enabled: true,
      },
      {
        name: 'project-hook',
        point: 'tool.execute.error' as const,
        type: 'observer' as const,
        command: 'project-cmd',
        enabled: true,
      },
    ];
    writeHookConfigs(projectDir, projectHooks);

    const merged = resolveHookConfigs(projectDir);

    expect(merged).toHaveLength(3);

    const globalHook = merged.find((h) => h.name === 'global-hook');
    expect(globalHook).toBeDefined();
    expect(globalHook!.command).toBe('global-cmd');

    const sharedHook = merged.find((h) => h.name === 'shared-hook');
    expect(sharedHook).toBeDefined();
    expect(sharedHook!.command).toBe('project-shared-cmd'); // project overrides global

    const projectHook = merged.find((h) => h.name === 'project-hook');
    expect(projectHook).toBeDefined();
    expect(projectHook!.command).toBe('project-cmd');
  });
});

describe('Hook disabled state', () => {
  const testHook = '__test_hook__';

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'codingcode-test-hooks-merge-project-'));
    globalDir = mkdtempSync(join(tmpdir(), 'codingcode-test-hooks-merge-global-'));
    mkdirSync(join(projectDir, '.codingcode'), { recursive: true });
    mkdirSync(join(globalDir, '.codingcode'), { recursive: true });
    _setGlobalConfigDir(globalDir);
    setGlobalHookDisabledState(testHook, false);
  });

  afterEach(() => {
    _setGlobalConfigDir(undefined);
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
    setGlobalHookDisabledState(testHook, false);
  });

  it('should default to not disabled globally', () => {
    expect(getGlobalHookDisabledState(testHook)).toBe(false);
  });

  it('should persist global disabled state', () => {
    setGlobalHookDisabledState(testHook, true);
    expect(getGlobalHookDisabledState(testHook)).toBe(true);
  });

  it('should return undefined when project has no config', () => {
    expect(getProjectHookDisabledState(projectDir, testHook)).toBe(undefined);
  });

  it('should persist project-level disabled state', () => {
    setProjectHookDisabledState(projectDir, testHook, true);
    expect(getProjectHookDisabledState(projectDir, testHook)).toBe(true);
  });

  it('should reset project-level disabled state', () => {
    setProjectHookDisabledState(projectDir, testHook, true);
    resetProjectHookDisabledState(projectDir, testHook);
    expect(getProjectHookDisabledState(projectDir, testHook)).toBe(undefined);
  });

  it('resolveHookDisabled should use project-level when set', () => {
    setGlobalHookDisabledState(testHook, false);
    setProjectHookDisabledState(projectDir, testHook, true);
    expect(resolveHookDisabled(projectDir, testHook)).toBe(true);
  });

  it('resolveHookDisabled should fall back to global when project not set', () => {
    setGlobalHookDisabledState(testHook, true);
    expect(resolveHookDisabled(projectDir, testHook)).toBe(true);
  });

  it('resolveHookDisabled should use project-level enabled over global disabled', () => {
    setGlobalHookDisabledState(testHook, true);
    setProjectHookDisabledState(projectDir, testHook, false);
    expect(resolveHookDisabled(projectDir, testHook)).toBe(false);
  });
});
