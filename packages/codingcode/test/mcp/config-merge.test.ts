import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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
} from '../../src/mcp/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PROJECT_DIR = join(__dirname, '..', '..', '..', 'test-fixture-mcp-merge');
const TEST_PROJECT_CODINGCODE = join(TEST_PROJECT_DIR, '.codingcode');

// 模拟全局目录
const TEST_GLOBAL_DIR = join(__dirname, '..', '..', '..', 'test-fixture-global', '.codingcode');

describe('MCP config merge', () => {
  beforeEach(() => {
    if (existsSync(TEST_PROJECT_DIR))
      rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
    mkdirSync(TEST_PROJECT_CODINGCODE, { recursive: true });
    if (existsSync(join(__dirname, '..', '..', '..', 'test-fixture-global')))
      rmSync(join(__dirname, '..', '..', '..', 'test-fixture-global'), { recursive: true, force: true });
    mkdirSync(TEST_GLOBAL_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_PROJECT_DIR))
      rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
    if (existsSync(join(__dirname, '..', '..', '..', 'test-fixture-global')))
      rmSync(join(__dirname, '..', '..', '..', 'test-fixture-global'), { recursive: true, force: true });
  });

  it('should merge global and project configs, project overrides global', () => {
    // Write global config
    writeGlobalMcpConfig([
      { name: 'global-server', transport: 'stdio', command: 'global-cmd', disabled: false, toolCount: 0 } as any,
      { name: 'shared-server', transport: 'stdio', command: 'global-shared-cmd', disabled: false, toolCount: 0 } as any,
    ]);

    // Write project config
    writeMcpConfig(TEST_PROJECT_DIR, [
      { name: 'shared-server', transport: 'stdio', command: 'project-shared-cmd', disabled: false, toolCount: 0 } as any,
      { name: 'project-server', transport: 'stdio', command: 'project-cmd', disabled: false, toolCount: 0 } as any,
    ]);

    const merged = resolveMcpConfig(TEST_PROJECT_DIR);

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
    writeMcpConfig(TEST_PROJECT_DIR, [
      { name: 'project-server', transport: 'stdio', command: 'project-cmd', disabled: false, toolCount: 0 } as any,
    ]);

    const merged = resolveMcpConfig(TEST_PROJECT_DIR);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('project-server');
  });

  it('should return only global config when no project config', () => {
    writeGlobalMcpConfig([
      { name: 'global-server', transport: 'stdio', command: 'global-cmd', disabled: false, toolCount: 0 } as any,
    ]);

    const merged = resolveMcpConfig(TEST_PROJECT_DIR);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('global-server');
  });
});

// Helper to write global config to test directory
function writeGlobalMcpConfig(servers: any[]): void {
  // Override the global config dir by writing to the test fixture
  const p = join(TEST_GLOBAL_DIR, 'mcp.yaml');
  writeFileSync(p, `servers:\n${servers.map((s) => `  - name: ${s.name}\n    transport: ${s.transport}\n    command: ${s.command}\n`).join('')}`, 'utf8');
}

describe('MCP disabled state', () => {
  const testServer = '__test_mcp_server__';

  beforeEach(() => {
    mkdirSync(TEST_PROJECT_CODINGCODE, { recursive: true });
    setGlobalMcpDisabledState(testServer, false);
  });

  afterEach(() => {
    rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
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
    expect(getProjectMcpDisabledState(TEST_PROJECT_DIR, testServer)).toBe(undefined);
  });

  it('should persist project-level disabled state', () => {
    setProjectMcpDisabledState(TEST_PROJECT_DIR, testServer, true);
    expect(getProjectMcpDisabledState(TEST_PROJECT_DIR, testServer)).toBe(true);
  });

  it('should reset project-level disabled state', () => {
    setProjectMcpDisabledState(TEST_PROJECT_DIR, testServer, true);
    resetProjectMcpDisabledState(TEST_PROJECT_DIR, testServer);
    expect(getProjectMcpDisabledState(TEST_PROJECT_DIR, testServer)).toBe(undefined);
  });

  it('resolveMcpDisabled should use project-level when set', () => {
    setGlobalMcpDisabledState(testServer, false);
    setProjectMcpDisabledState(TEST_PROJECT_DIR, testServer, true);
    expect(resolveMcpDisabled(TEST_PROJECT_DIR, testServer)).toBe(true);
  });

  it('resolveMcpDisabled should fall back to global when project not set', () => {
    setGlobalMcpDisabledState(testServer, true);
    expect(resolveMcpDisabled(TEST_PROJECT_DIR, testServer)).toBe(true);
  });

  it('resolveMcpDisabled should use project-level enabled over global disabled', () => {
    setGlobalMcpDisabledState(testServer, true);
    setProjectMcpDisabledState(TEST_PROJECT_DIR, testServer, false);
    expect(resolveMcpDisabled(TEST_PROJECT_DIR, testServer)).toBe(false);
  });
});
