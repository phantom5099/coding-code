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
} from '../../src/hooks/config.js';
import type { UserHookConfig } from '../../src/contracts/hooks.js';
import { useTempHome, setFakeHome } from '../helpers/temp-home.js';

let projectDir: string;
// 全局层落在临时 home 里，避免读到/写坏开发机的 ~/.codingcode（全局配置目录不可指定）
const tempHome = useTempHome('codingcode-test-hooks-merge-');

function readYaml(p: string): any {
  return parseYaml(readFileSync(p, 'utf8'));
}

function hook(name: string, command: string): UserHookConfig {
  return { name, point: 'tool.execute.before', type: 'observer', command };
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'codingcode-test-hooks-merge-project-'));
  mkdirSync(join(projectDir, '.codingcode'), { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('Hooks config merge', () => {
  it('全局目录不存在时写入会自行创建', () => {
    const nestedHome = join(tempHome.home, 'nested', 'home'); // 连 home 本身都还不存在
    setFakeHome(nestedHome);

    writeGlobalHookConfigs([hook('a', 'x')]);

    expect(readYaml(join(nestedHome, '.codingcode', 'hooks.yaml')).hooks).toEqual([
      { name: 'a', point: 'tool.execute.before', type: 'observer', command: 'x' },
    ]);
  });

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

    expect(readYaml(join(tempHome.configDir, 'hooks.yaml')).hooks[0]).toEqual({
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
