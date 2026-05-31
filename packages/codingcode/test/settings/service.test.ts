import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlreadyExistsError, NotFoundError } from '../../src/settings/service.js';

// Mock the file system based modules
vi.mock('../../src/mcp/config.js', () => ({
  loadMcpConfig: vi.fn(),
  writeMcpConfig: vi.fn(),
}));

vi.mock('../../src/subagent/loader.js', () => ({
  loadAgentProfiles: vi.fn(),
  writeAgentProfile: vi.fn(),
  updateAgentProfile: vi.fn(),
  deleteAgentProfile: vi.fn(),
}));

vi.mock('../../src/subagent/registry.js', () => ({
  EXPLORE_PROFILE: { name: 'explore', description: 'Read-only code exploration', tools: ['read_file', 'search_code'] },
  isAgentDisabledState: vi.fn().mockReturnValue(false),
  setAgentDisabledState: vi.fn(),
}));

vi.mock('../../src/hooks/config.js', () => ({
  loadHookConfigs: vi.fn(),
  writeHookConfigs: vi.fn(),
}));

vi.mock('../../src/hooks/executor.js', () => ({
  setHookRuntimeEnabled: vi.fn(),
}));

vi.mock('../../src/memory/config.js', () => ({
  getMemoryConfig: vi.fn().mockReturnValue({ enabled: true, disabledTypes: [], extraTypes: [] }),
  getAllTypesWithStatus: vi.fn().mockReturnValue([]),
  setMemoryTypeDisabled: vi.fn(),
  addMemoryExtraType: vi.fn(),
  updateMemoryExtraType: vi.fn(),
  deleteMemoryExtraType: vi.fn(),
}));

vi.mock('../../src/memory/index.js', () => ({
  getMemoryEnabled: vi.fn().mockReturnValue(true),
  setMemoryEnabled: vi.fn(),
}));

vi.mock('../../src/subagent/registry.js', () => ({
  EXPLORE_PROFILE: { name: 'explore', description: 'Read-only code exploration', tools: ['read_file', 'search_code'] },
  isAgentDisabledState: vi.fn().mockReturnValue(false),
  setAgentDisabledState: vi.fn(),
  getSubagentEnabledState: vi.fn().mockReturnValue(true),
  setSubagentEnabledState: vi.fn(),
}));

import * as service from '../../src/settings/service.js';
import { loadMcpConfig, writeMcpConfig } from '../../src/mcp/config.js';
import { loadAgentProfiles, writeAgentProfile, updateAgentProfile } from '../../src/subagent/loader.js';
import { loadHookConfigs, writeHookConfigs } from '../../src/hooks/config.js';
import { EXPLORE_PROFILE, isAgentDisabledState, getSubagentEnabledState, setSubagentEnabledState } from '../../src/subagent/registry.js';
import { getMemoryConfig, getAllTypesWithStatus, setMemoryTypeDisabled, addMemoryExtraType, updateMemoryExtraType, deleteMemoryExtraType } from '../../src/memory/config.js';
import { getMemoryEnabled, setMemoryEnabled } from '../../src/memory/index.js';

const mockLoadMcpConfig = vi.mocked(loadMcpConfig);
const mockWriteMcpConfig = vi.mocked(writeMcpConfig);
const mockLoadAgentProfiles = vi.mocked(loadAgentProfiles);
const mockWriteAgentProfile = vi.mocked(writeAgentProfile);
const mockUpdateAgentProfile = vi.mocked(updateAgentProfile);
const mockLoadHookConfigs = vi.mocked(loadHookConfigs);
const mockWriteHookConfigs = vi.mocked(writeHookConfigs);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP server operations', () => {
  it('createMcpServer throws AlreadyExistsError on duplicate name', () => {
    mockLoadMcpConfig.mockReturnValue([{ name: 'existing', transport: 'stdio', command: 'echo', concurrency: 1, autoReconnect: false } as any]);
    expect(() => service.createMcpServer('/cwd', { name: 'existing', transport: 'stdio', command: 'echo' } as any))
      .toThrow(AlreadyExistsError);
    expect(mockWriteMcpConfig).not.toHaveBeenCalled();
  });

  it('updateMcpServer throws NotFoundError when server missing', () => {
    mockLoadMcpConfig.mockReturnValue([]);
    expect(() => service.updateMcpServer('/cwd', 'nonexistent', { name: 'nonexistent' } as any))
      .toThrow(NotFoundError);
  });

  it('updateMcpServer throws AlreadyExistsError on rename conflict', () => {
    mockLoadMcpConfig.mockReturnValue([
      { name: 'a', transport: 'stdio', command: 'echo', concurrency: 1, autoReconnect: false },
      { name: 'b', transport: 'stdio', command: 'echo', concurrency: 1, autoReconnect: false },
    ] as any);
    expect(() => service.updateMcpServer('/cwd', 'a', { name: 'b' } as any)).toThrow(AlreadyExistsError);
  });
});

describe('Agent operations', () => {
  it('createAgent throws AlreadyExistsError on duplicate name', () => {
    mockLoadAgentProfiles.mockReturnValue([{ name: 'existing', description: 'test' }]);
    expect(() => service.createAgent('/cwd', { name: 'existing', description: 'test' })).toThrow(AlreadyExistsError);
    expect(mockWriteAgentProfile).not.toHaveBeenCalled();
  });

  it('updateAgent throws NotFoundError when agent missing', () => {
    mockLoadAgentProfiles.mockReturnValue([]);
    expect(() => service.updateAgent('/cwd', 'nonexistent', { name: 'test', description: 'test' })).toThrow(NotFoundError);
  });

  it('updateAgent throws AlreadyExistsError on rename conflict', () => {
    mockLoadAgentProfiles.mockReturnValue([{ name: 'a', description: 'x' }, { name: 'b', description: 'y' }]);
    expect(() => service.updateAgent('/cwd', 'a', { name: 'b', description: 'z' })).toThrow(AlreadyExistsError);
  });
});

describe('Hook operations', () => {
  it('createHook throws AlreadyExistsError on duplicate name', () => {
    mockLoadHookConfigs.mockReturnValue([{ name: 'existing', point: 'test', command: 'echo', enabled: true, type: 'observer' }]);
    expect(() => service.createHook('/cwd', { name: 'existing', point: 'test', command: 'echo', enabled: true, type: 'observer' })).toThrow(AlreadyExistsError);
    expect(mockWriteHookConfigs).not.toHaveBeenCalled();
  });

  it('updateHook throws NotFoundError when hook missing', () => {
    mockLoadHookConfigs.mockReturnValue([]);
    expect(() => service.updateHook('/cwd', 'nonexistent', { name: 'test', point: 'test', command: 'echo', enabled: true, type: 'observer' })).toThrow(NotFoundError);
  });

  it('setHookDisabled updates both runtime and config enabled state', () => {
    const hooks = [{ name: 'test-hook', point: 'test', command: 'echo', enabled: true, type: 'observer' }];
    mockLoadHookConfigs.mockReturnValue(hooks);
    service.setHookDisabled('/cwd', 'test-hook', true);
    expect(mockWriteHookConfigs).toHaveBeenCalledWith('/cwd', [{ name: 'test-hook', point: 'test', command: 'echo', enabled: false, type: 'observer' }]);
  });
});

describe('listAgents', () => {
  it('includes explore profile and custom agents with disabled state', () => {
    mockLoadAgentProfiles.mockReturnValue([{ name: 'custom', description: 'Custom agent' }]);
    vi.mocked(isAgentDisabledState).mockReturnValue(true);
    const result = service.listAgents('/cwd');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('explore');
    expect(result[1].name).toBe('custom');
    expect(result[1].disabled).toBe(true);
  });
});

describe('Memory operations', () => {
  it('getMemoryConfigWithTypes returns enabled and types', () => {
    vi.mocked(getMemoryConfig).mockReturnValue({ enabled: true, disabledTypes: [], extraTypes: [] } as any);
    vi.mocked(getAllTypesWithStatus).mockReturnValue([
      { name: 'test', description: 'Test', isBuiltIn: true, disabled: false },
    ]);
    const result = service.getMemoryConfigWithTypes();
    expect(result.enabled).toBe(true);
    expect(result.types).toHaveLength(1);
    expect(result.types[0]!.name).toBe('test');
  });

  it('setMemoryEnabledService delegates to setMemoryEnabled', () => {
    service.setMemoryEnabledService(false);
    expect(setMemoryEnabled).toHaveBeenCalledWith(false);
  });

  it('getMemoryEnabledService delegates to getMemoryEnabled', () => {
    vi.mocked(getMemoryEnabled).mockReturnValue(false);
    expect(service.getMemoryEnabledService()).toBe(false);
  });

  it('addMemoryExtraTypeService wraps AlreadyExistsError', () => {
    vi.mocked(addMemoryExtraType).mockImplementation(() => {
      throw new Error("Memory type 'dup' already exists");
    });
    expect(() => service.addMemoryExtraTypeService({ name: 'dup', description: 'x' })).toThrow(AlreadyExistsError);
  });

  it('updateMemoryExtraTypeService wraps NotFoundError', () => {
    vi.mocked(updateMemoryExtraType).mockImplementation(() => {
      throw new Error("Memory type 'missing' not found");
    });
    expect(() => service.updateMemoryExtraTypeService('missing', { name: 'missing', description: 'x' })).toThrow(NotFoundError);
  });

  it('deleteMemoryExtraTypeService delegates to deleteMemoryExtraType', () => {
    service.deleteMemoryExtraTypeService('old');
    expect(deleteMemoryExtraType).toHaveBeenCalledWith('old');
  });
});

describe('Subagent operations', () => {
  it('getSubagentEnabled delegates to getSubagentEnabledState', () => {
    vi.mocked(getSubagentEnabledState).mockReturnValue(false);
    expect(service.getSubagentEnabled()).toBe(false);
  });

  it('setSubagentEnabled delegates to setSubagentEnabledState', () => {
    service.setSubagentEnabled(false);
    expect(setSubagentEnabledState).toHaveBeenCalledWith(false);
  });
});
