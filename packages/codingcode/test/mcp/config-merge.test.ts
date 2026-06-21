import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadMcpConfig,
  writeMcpConfig,
  loadGlobalMcpConfig,
  writeGlobalMcpConfig,
  resolveMcpConfig,
  getGlobalMcpDisabledState,
  setGlobalMcpDisabledState,
  getProjectMcpDisabledState,
  setProjectMcpDisabledState,
  resetProjectMcpDisabledState,
  resolveMcpDisabled,
  _setGlobalConfigDir,
} from '../../src/mcp/config.js';

let projectDir: string;
let globalDir: string;

describe('MCP config merge', () => {
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'codingcode-test-mcp-merge-project-'));
    globalDir = mkdtempSync(join(tmpdir(), 'codingcode-test-mcp-merge-global-'));
    mkdirSync(join(projectDir, '.codingcode'), { recursive: true });
    mkdirSync(join(globalDir, '.codingcode'), { recursive: true });
    _setGlobalConfigDir(globalDir);
  });

  afterEach(() => {
    _setGlobalConfigDir(undefined);
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  });

  it('should merge global and project configs, project overrides global', () => {
    // Write global config
    writeGlobalMcpConfig([
      {
        name: 'global-server',
        transport: 'stdio',
        command: 'global-cmd',
        disabled: false,
        toolCount: 0,
      } as any,
      {
        name: 'shared-server',
        transport: 'stdio',
        command: 'global-shared-cmd',
        disabled: false,
        toolCount: 0,
      } as any,
    ]);

    // Write project config
    writeMcpConfig(projectDir, [
      {
        name: 'shared-server',
        transport: 'stdio',
        command: 'project-shared-cmd',
        disabled: false,
        toolCount: 0,
      } as any,
      {
        name: 'project-server',
        transport: 'stdio',
        command: 'project-cmd',
        disabled: false,
        toolCount: 0,
      } as any,
    ]);

    const merged = resolveMcpConfig(projectDir);

    // Should have 3 servers: global-server, shared-server (project override), project-server
    expect(merged).toHaveLength(3);

    const globalServer = merged.find((s) => s.name === 'global-server');
    expect(globalServer).toBeDefined();
    expect((globalServer as any).command).toBe('global-cmd');

    const sharedServer = merged.find((s) => s.name === 'shared-server');
    expect(sharedServer).toBeDefined();
    expect((sharedServer as any).command).toBe('project-shared-cmd'); // project overrides global

    const projectServer = merged.find((s) => s.name === 'project-server');
    expect(projectServer).toBeDefined();
    expect((projectServer as any).command).toBe('project-cmd');
  });

  it('should return only project config when no global config', () => {
    writeMcpConfig(projectDir, [
      {
        name: 'project-server',
        transport: 'stdio',
        command: 'project-cmd',
        disabled: false,
        toolCount: 0,
      } as any,
    ]);

    const merged = resolveMcpConfig(projectDir);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('project-server');
  });

  it('should return only global config when no project config', () => {
    writeGlobalMcpConfig([
      {
        name: 'global-server',
        transport: 'stdio',
        command: 'global-cmd',
        disabled: false,
        toolCount: 0,
      } as any,
    ]);

    const merged = resolveMcpConfig(projectDir);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('global-server');
  });
});

describe('MCP disabled state', () => {
  const testServer = '__test_mcp_server__';

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'codingcode-test-mcp-merge-project-'));
    globalDir = mkdtempSync(join(tmpdir(), 'codingcode-test-mcp-merge-global-'));
    mkdirSync(join(projectDir, '.codingcode'), { recursive: true });
    mkdirSync(join(globalDir, '.codingcode'), { recursive: true });
    _setGlobalConfigDir(globalDir);
    setGlobalMcpDisabledState(testServer, false);
  });

  afterEach(() => {
    _setGlobalConfigDir(undefined);
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
    setGlobalMcpDisabledState(testServer, false);
  });

  it('should default to not disabled globally', () => {
    expect(getGlobalMcpDisabledState(testServer)).toBe(false);
  });

  it('should persist global disabled state', () => {
    setGlobalMcpDisabledState(testServer, true);
    expect(getGlobalMcpDisabledState(testServer)).toBe(true);
  });

  it('should return undefined when project has no config', () => {
    expect(getProjectMcpDisabledState(projectDir, testServer)).toBe(undefined);
  });

  it('should persist project-level disabled state', () => {
    setProjectMcpDisabledState(projectDir, testServer, true);
    expect(getProjectMcpDisabledState(projectDir, testServer)).toBe(true);
  });

  it('should reset project-level disabled state', () => {
    setProjectMcpDisabledState(projectDir, testServer, true);
    resetProjectMcpDisabledState(projectDir, testServer);
    expect(getProjectMcpDisabledState(projectDir, testServer)).toBe(undefined);
  });

  it('resolveMcpDisabled should use project-level when set', () => {
    setGlobalMcpDisabledState(testServer, false);
    setProjectMcpDisabledState(projectDir, testServer, true);
    expect(resolveMcpDisabled(projectDir, testServer)).toBe(true);
  });

  it('resolveMcpDisabled should fall back to global when project not set', () => {
    setGlobalMcpDisabledState(testServer, true);
    expect(resolveMcpDisabled(projectDir, testServer)).toBe(true);
  });

  it('resolveMcpDisabled should use project-level enabled over global disabled', () => {
    setGlobalMcpDisabledState(testServer, true);
    setProjectMcpDisabledState(projectDir, testServer, false);
    expect(resolveMcpDisabled(projectDir, testServer)).toBe(false);
  });
});
