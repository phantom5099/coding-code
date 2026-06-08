import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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
} from '../../src/hooks/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PROJECT_DIR = join(__dirname, '..', '..', '..', 'test-fixture-hooks-merge');
const TEST_PROJECT_CODINGCODE = join(TEST_PROJECT_DIR, '.codingcode');
const TEST_GLOBAL_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'test-fixture-global-hooks',
  '.codingcode'
);

describe('Hooks config merge', () => {
  beforeEach(() => {
    if (existsSync(TEST_PROJECT_DIR)) rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
    mkdirSync(TEST_PROJECT_CODINGCODE, { recursive: true });
    if (existsSync(join(__dirname, '..', '..', '..', 'test-fixture-global-hooks')))
      rmSync(join(__dirname, '..', '..', '..', 'test-fixture-global-hooks'), {
        recursive: true,
        force: true,
      });
    mkdirSync(TEST_GLOBAL_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_PROJECT_DIR)) rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
    if (existsSync(join(__dirname, '..', '..', '..', 'test-fixture-global-hooks')))
      rmSync(join(__dirname, '..', '..', '..', 'test-fixture-global-hooks'), {
        recursive: true,
        force: true,
      });
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
    writeHookConfigs(TEST_PROJECT_DIR, projectHooks);

    const merged = resolveHookConfigs(TEST_PROJECT_DIR);

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
    mkdirSync(TEST_PROJECT_CODINGCODE, { recursive: true });
    setGlobalHookDisabledState(testHook, false);
  });

  afterEach(() => {
    rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
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
    expect(getProjectHookDisabledState(TEST_PROJECT_DIR, testHook)).toBe(undefined);
  });

  it('should persist project-level disabled state', () => {
    setProjectHookDisabledState(TEST_PROJECT_DIR, testHook, true);
    expect(getProjectHookDisabledState(TEST_PROJECT_DIR, testHook)).toBe(true);
  });

  it('should reset project-level disabled state', () => {
    setProjectHookDisabledState(TEST_PROJECT_DIR, testHook, true);
    resetProjectHookDisabledState(TEST_PROJECT_DIR, testHook);
    expect(getProjectHookDisabledState(TEST_PROJECT_DIR, testHook)).toBe(undefined);
  });

  it('resolveHookDisabled should use project-level when set', () => {
    setGlobalHookDisabledState(testHook, false);
    setProjectHookDisabledState(TEST_PROJECT_DIR, testHook, true);
    expect(resolveHookDisabled(TEST_PROJECT_DIR, testHook)).toBe(true);
  });

  it('resolveHookDisabled should fall back to global when project not set', () => {
    setGlobalHookDisabledState(testHook, true);
    expect(resolveHookDisabled(TEST_PROJECT_DIR, testHook)).toBe(true);
  });

  it('resolveHookDisabled should use project-level enabled over global disabled', () => {
    setGlobalHookDisabledState(testHook, true);
    setProjectHookDisabledState(TEST_PROJECT_DIR, testHook, false);
    expect(resolveHookDisabled(TEST_PROJECT_DIR, testHook)).toBe(false);
  });
});
