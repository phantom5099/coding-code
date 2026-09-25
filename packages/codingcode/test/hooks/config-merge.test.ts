import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import {
  loadHookConfigs,
  writeHookConfigs,
  loadGlobalHookConfigs,
  writeGlobalHookConfigs,
  resolveHookConfigs,
  setGlobalHookEnabled,
  setProjectHookEnabled,
  _setGlobalConfigDir,
} from '../../src/hooks/config.js';
import type { UserHookConfig } from '../../src/contracts/hooks.js';

let projectDir: string;
let globalDir: string;

function readYaml(p: string): any {
  return parseYaml(readFileSync(p, 'utf8'));
}

function hook(name: string, command: string): UserHookConfig {
  return { name, point: 'tool.execute.before', type: 'observer', command };
}

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

describe('Hooks config merge', () => {
  it('merges global and project by name, project wins', () => {
    writeGlobalHookConfigs([hook('global-hook', 'global-cmd'), hook('shared-hook', 'global-shared')]);
    writeHookConfigs(projectDir, [
      hook('shared-hook', 'project-shared'),
      hook('project-hook', 'project-cmd'),
    ]);

    const merged = resolveHookConfigs(projectDir);

    expect(merged).toHaveLength(3);
    expect(merged.find((h) => h.name === 'global-hook')!.command).toBe('global-cmd');
    expect(merged.find((h) => h.name === 'shared-hook')!.command).toBe('project-shared');
    expect(merged.find((h) => h.name === 'project-hook')!.command).toBe('project-cmd');
  });

  it('project layer only overrides the fields it declares', () => {
    writeGlobalHookConfigs([hook('shared', 'global-cmd')]);
    // 项目层只写了 name + enabled
    writeHookConfigs(projectDir, [{ name: 'shared', enabled: false } as UserHookConfig]);

    const merged = resolveHookConfigs(projectDir);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.command).toBe('global-cmd');
    expect(merged[0]!.point).toBe('tool.execute.before');
    expect(merged[0]!.enabled).toBe(false);
  });
});

describe('Hook enabled switch (a plain boolean field in hooks.yaml)', () => {
  it('absent field means enabled', () => {
    writeGlobalHookConfigs([hook('a', 'x')]);

    const merged = resolveHookConfigs(projectDir);
    expect(merged[0]!.enabled).toBeUndefined();
    expect(merged[0]!.enabled !== false).toBe(true);
  });

  it('writes the boolean to the global hooks.yaml', () => {
    writeGlobalHookConfigs([hook('a', 'x')]);

    setGlobalHookEnabled('a', false);

    expect(readYaml(join(globalDir, 'hooks.yaml')).hooks[0]).toEqual({
      name: 'a',
      point: 'tool.execute.before',
      type: 'observer',
      command: 'x',
      enabled: false,
    });
    expect(loadGlobalHookConfigs()[0]!.enabled).toBe(false);
  });

  it('project toggle writes a minimal override that wins over the global definition', () => {
    writeGlobalHookConfigs([hook('a', 'x')]);

    setProjectHookEnabled(projectDir, 'a', false);

    expect(readYaml(join(projectDir, '.codingcode', 'hooks.yaml')).hooks).toEqual([
      { name: 'a', enabled: false },
    ]);
    const merged = resolveHookConfigs(projectDir);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.enabled).toBe(false);
    expect(merged[0]!.command).toBe('x');
  });

  it('patches an existing project entry in place', () => {
    writeHookConfigs(projectDir, [hook('a', 'proj-cmd')]);

    setProjectHookEnabled(projectDir, 'a', false);

    expect(readYaml(join(projectDir, '.codingcode', 'hooks.yaml')).hooks).toEqual([
      {
        name: 'a',
        point: 'tool.execute.before',
        type: 'observer',
        command: 'proj-cmd',
        enabled: false,
      },
    ]);
  });

  it('round-trips back to enabled', () => {
    writeGlobalHookConfigs([hook('a', 'x')]);
    setGlobalHookEnabled('a', false);
    setGlobalHookEnabled('a', true);

    expect(loadHookConfigs(projectDir)).toEqual([]);
    expect(loadGlobalHookConfigs()[0]!.enabled).toBe(true);
  });
});
