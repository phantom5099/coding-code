import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import {
  loadMcpConfig,
  writeMcpConfig,
  loadGlobalMcpConfig,
  writeGlobalMcpConfig,
  resolveMcpConfig,
  setGlobalMcpServerEnabled,
  setProjectMcpServerEnabled,
} from '../../src/mcp/config.js';
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

    writeGlobalMcpConfig([{ name: 's', command: 'c' }]);

    expect(readYaml(join(nestedHome, '.codingcode', 'mcp.yaml')).servers).toEqual([
      { name: 's', command: 'c' },
    ]);
  });

  it('merges global and project by name, project wins', () => {
    writeGlobalMcpConfig([
      { name: 'global-server', command: 'global-cmd' },
      { name: 'shared-server', command: 'global-shared-cmd' },
    ]);
    writeMcpConfig(projectDir, [
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
    writeGlobalMcpConfig([{ name: 'shared', command: 'global-cmd', args: ['--a'], concurrency: 5 }]);
    writeMcpConfig(projectDir, [{ name: 'shared', command: 'project-cmd' }]);

    const merged = resolveMcpConfig(projectDir);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.command).toBe('project-cmd');
    expect(merged[0]!.args).toEqual(['--a']);
    expect(merged[0]!.concurrency).toBe(5);
  });

  it('returns only project config when no global config', () => {
    writeMcpConfig(projectDir, [{ name: 'project-server', command: 'project-cmd' }]);

    const merged = resolveMcpConfig(projectDir);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('project-server');
  });

  it('returns only global config when no project config', () => {
    writeGlobalMcpConfig([{ name: 'global-server', command: 'global-cmd' }]);

    const merged = resolveMcpConfig(projectDir);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('global-server');
  });
});

describe('MCP enabled switch (a plain boolean field in mcp.yaml)', () => {
  it('absent field means enabled', () => {
    writeGlobalMcpConfig([{ name: 'a', command: 'x' }]);

    const merged = resolveMcpConfig(projectDir);
    expect(merged[0]!.enabled).toBeUndefined();
    expect(merged[0]!.enabled !== false).toBe(true);
  });

  it('writes the boolean to the global mcp.yaml', () => {
    writeGlobalMcpConfig([{ name: 'a', command: 'x' }]);

    setGlobalMcpServerEnabled('a', false);

    expect(readYaml(join(tempHome.configDir, 'mcp.yaml')).servers).toEqual([
      { name: 'a', command: 'x', enabled: false },
    ]);
    expect(loadGlobalMcpConfig()[0]!.enabled).toBe(false);
  });

  it('project toggle writes a minimal override that wins over the global definition', () => {
    writeGlobalMcpConfig([{ name: 'a', command: 'x' }]);

    setProjectMcpServerEnabled(projectDir, 'a', false);

    expect(readYaml(join(projectDir, '.codingcode', 'mcp.yaml')).servers).toEqual([
      { name: 'a', enabled: false },
    ]);
    const merged = resolveMcpConfig(projectDir);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.enabled).toBe(false);
    expect(merged[0]!.command).toBe('x');
  });

  it('patches an existing project entry in place', () => {
    writeMcpConfig(projectDir, [{ name: 'a', command: 'proj-cmd' }]);

    setProjectMcpServerEnabled(projectDir, 'a', false);

    expect(readYaml(join(projectDir, '.codingcode', 'mcp.yaml')).servers).toEqual([
      { name: 'a', command: 'proj-cmd', enabled: false },
    ]);
  });

  it('round-trips back to enabled', () => {
    writeGlobalMcpConfig([{ name: 'a', command: 'x' }]);
    setGlobalMcpServerEnabled('a', false);
    setGlobalMcpServerEnabled('a', true);

    expect(loadMcpConfig(projectDir)).toEqual([]);
    expect(loadGlobalMcpConfig()[0]!.enabled).toBe(true);
  });
});
