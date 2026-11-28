import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import {
  loadMcpConfig,
  writeMcpConfig,
  resolveMcpConfig,
  setMcpServerEnabledConfig,
} from '@codingcode/mcp';
import { GLOBAL_CONFIG_SCOPE, projectConfigScope } from '@codingcode/util';
import { useTempHome, setFakeHome } from '../helpers/temp-home.js';

let projectDir: string;
// 全局层落在临时 home 里，避免读到/写坏开发机的 ~/.codingcode（全局配置目录不可指定）
const tempHome = useTempHome('codingcode-test-mcp-merge-');

function readYaml(p: string): any {
  return parseYaml(readFileSync(p, 'utf8'));
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'codingcode-test-mcp-merge-project-'));
  mkdirSync(join(projectDir, '.codingcode'), { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('MCP config merge', () => {
  it('全局目录不存在时写入会自行创建', () => {
    const nestedHome = join(tempHome.home, 'nested', 'home'); // 连 home 本身都还不存在
    setFakeHome(nestedHome);

    writeMcpConfig(GLOBAL_CONFIG_SCOPE, [{ name: 's', command: 'c' }]);

    expect(readYaml(join(nestedHome, '.codingcode', 'mcp.yaml')).servers).toEqual([
      { name: 's', command: 'c' },
    ]);
  });

  it('merges global and project by name, project wins', () => {
    writeMcpConfig(GLOBAL_CONFIG_SCOPE, [
      { name: 'global-server', command: 'global-cmd' },
      { name: 'shared-server', command: 'global-shared-cmd' },
    ]);
    writeMcpConfig(projectConfigScope(projectDir), [
      { name: 'shared-server', command: 'project-shared-cmd' },
      { name: 'project-server', command: 'project-cmd' },
    ]);

    const merged = resolveMcpConfig(projectDir);

    expect(merged).toHaveLength(3);
    expect(merged.find((s) => s.name === 'global-server')!.command).toBe('global-cmd');
    expect(merged.find((s) => s.name === 'shared-server')!.command).toBe('project-shared-cmd');
    expect(merged.find((s) => s.name === 'project-server')!.command).toBe('project-cmd');
  });

  it('project layer only overrides the fields it declares', () => {
    writeMcpConfig(GLOBAL_CONFIG_SCOPE, [
      { name: 'shared', command: 'global-cmd', args: ['--a'], concurrency: 5 },
    ]);
    writeMcpConfig(projectConfigScope(projectDir), [{ name: 'shared', command: 'project-cmd' }]);

    const merged = resolveMcpConfig(projectDir);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.command).toBe('project-cmd');
    expect(merged[0]!.args).toEqual(['--a']);
    expect(merged[0]!.concurrency).toBe(5);
  });

  it('returns only project config when no global config', () => {
    writeMcpConfig(projectConfigScope(projectDir), [{ name: 'project-server', command: 'project-cmd' }]);

    const merged = resolveMcpConfig(projectDir);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('project-server');
  });

  it('returns only global config when no project config', () => {
    writeMcpConfig(GLOBAL_CONFIG_SCOPE, [{ name: 'global-server', command: 'global-cmd' }]);

    const merged = resolveMcpConfig(projectDir);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('global-server');
  });
});

describe('MCP enabled switch (a plain boolean field in mcp.yaml)', () => {
  it('absent field means enabled', () => {
    writeMcpConfig(GLOBAL_CONFIG_SCOPE, [{ name: 'a', command: 'x' }]);

    const merged = resolveMcpConfig(projectDir);
    expect(merged[0]!.enabled).toBeUndefined();
    expect(merged[0]!.enabled !== false).toBe(true);
  });

  it('writes the boolean to the global mcp.yaml', () => {
    writeMcpConfig(GLOBAL_CONFIG_SCOPE, [{ name: 'a', command: 'x' }]);

    setMcpServerEnabledConfig({ scope: GLOBAL_CONFIG_SCOPE, name: 'a', enabled: false });

    expect(readYaml(join(tempHome.configDir, 'mcp.yaml')).servers).toEqual([
      { name: 'a', command: 'x', enabled: false },
    ]);
    expect(loadMcpConfig(GLOBAL_CONFIG_SCOPE)[0]!.enabled).toBe(false);
  });

  it('project toggle writes a minimal override that wins over the global definition', () => {
    writeMcpConfig(GLOBAL_CONFIG_SCOPE, [{ name: 'a', command: 'x' }]);

    setMcpServerEnabledConfig({ scope: projectConfigScope(projectDir), name: 'a', enabled: false });

    expect(readYaml(join(projectDir, '.codingcode', 'mcp.yaml')).servers).toEqual([
      { name: 'a', enabled: false },
    ]);
    const merged = resolveMcpConfig(projectDir);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.enabled).toBe(false);
    expect(merged[0]!.command).toBe('x');
  });

  it('patches an existing project entry in place', () => {
    writeMcpConfig(projectConfigScope(projectDir), [{ name: 'a', command: 'proj-cmd' }]);

    setMcpServerEnabledConfig({ scope: projectConfigScope(projectDir), name: 'a', enabled: false });

    expect(readYaml(join(projectDir, '.codingcode', 'mcp.yaml')).servers).toEqual([
      { name: 'a', command: 'proj-cmd', enabled: false },
    ]);
  });

  it('round-trips back to enabled', () => {
    writeMcpConfig(GLOBAL_CONFIG_SCOPE, [{ name: 'a', command: 'x' }]);
    setMcpServerEnabledConfig({ scope: GLOBAL_CONFIG_SCOPE, name: 'a', enabled: false });
    setMcpServerEnabledConfig({ scope: GLOBAL_CONFIG_SCOPE, name: 'a', enabled: true });

    expect(loadMcpConfig(projectConfigScope(projectDir))).toEqual([]);
    expect(loadMcpConfig(GLOBAL_CONFIG_SCOPE)[0]!.enabled).toBe(true);
  });
});
