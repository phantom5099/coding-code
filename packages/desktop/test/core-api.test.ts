import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockApi, mockAgent, mockSessions } = vi.hoisted(() => {
  const mockSettings = {
    getSubagentEnabled: vi.fn(),
    setSubagentEnabled: vi.fn(),
    resetSubagentEnabled: vi.fn(),
    setAgentDisabled: vi.fn(),
    resetAgentDisabled: vi.fn(),
    setMcpDisabled: vi.fn(),
    resetMcpDisabled: vi.fn(),
    setHookDisabled: vi.fn(),
    resetHookDisabled: vi.fn(),
    toggleSkill: vi.fn(),
    getMemoryConfig: vi.fn(),
    setMemoryModel: vi.fn(),
    getAgentConfig: vi.fn(),
    setCompactionModel: vi.fn(),
  };
  const mockApi = vi.fn();
  const mockAgent = {
    sendApprovalResponse: vi.fn(),
  };
  const mockSessions = {
    listSessions: vi.fn(),
    getSessionMode: vi.fn(),
    setSessionMode: vi.fn(),
    getSessionPlan: vi.fn(),
  };
  return { mockSettings, mockApi, mockAgent, mockSessions };
});

vi.mock('../src/lib/api', () => ({
  API_BASE: 'http://localhost:3000',
  api: mockApi,
}));

vi.mock('@codingcode/core/client/http-clients', () => ({
  createHttpClients: () => ({
    settings: mockSettings,
    models: { listModels: vi.fn(), switchModel: vi.fn() },
    sessions: mockSessions,
    agent: mockAgent,
  }),
}));

import {
  getSubagentEnabled,
  setSubagentEnabled,
  resetSubagentEnabled,
  setAgentDisabled,
  resetAgentDisabled,
  setMcpDisabled,
  resetMcpDisabled,
  setHookDisabled,
  resetHookDisabled,
  toggleSkill,
  getMemoryConfig,
  setMemoryModel,
  getAgentConfig,
  setAgentConfig,
  setCompactionModel,
  getSessionPlan,
  getSessionMode,
  setSessionMode,
} from '../src/lib/core-api';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- getSubagentEnabled ----

describe('getSubagentEnabled', () => {
  it('calls settings.getSubagentEnabled with empty cwd when no cwd provided', async () => {
    mockSettings.getSubagentEnabled.mockResolvedValue({ enabled: true, source: 'global' });
    const result = await getSubagentEnabled();
    expect(mockSettings.getSubagentEnabled).toHaveBeenCalledWith({ cwd: '' });
    expect(result).toEqual({ enabled: true, source: 'global' });
  });

  it('calls settings.getSubagentEnabled with provided cwd', async () => {
    mockSettings.getSubagentEnabled.mockResolvedValue({ enabled: false, source: 'project' });
    const result = await getSubagentEnabled('/some/path');
    expect(mockSettings.getSubagentEnabled).toHaveBeenCalledWith({ cwd: '/some/path' });
    expect(result).toEqual({ enabled: false, source: 'project' });
  });
});

// ---- setSubagentEnabled ----

describe('setSubagentEnabled', () => {
  it('calls settings.setSubagentEnabled with empty cwd when no cwd provided', async () => {
    mockSettings.setSubagentEnabled.mockResolvedValue(undefined);
    await setSubagentEnabled(true);
    expect(mockSettings.setSubagentEnabled).toHaveBeenCalledWith({ enabled: true, cwd: '' });
  });

  it('calls settings.setSubagentEnabled with provided cwd', async () => {
    mockSettings.setSubagentEnabled.mockResolvedValue(undefined);
    await setSubagentEnabled(false, '/project/dir');
    expect(mockSettings.setSubagentEnabled).toHaveBeenCalledWith({
      enabled: false,
      cwd: '/project/dir',
    });
  });
});

// ---- resetSubagentEnabled ----

describe('resetSubagentEnabled', () => {
  it('calls settings.resetSubagentEnabled with cwd', async () => {
    mockSettings.resetSubagentEnabled.mockResolvedValue(undefined);
    await resetSubagentEnabled('/project/dir');
    expect(mockSettings.resetSubagentEnabled).toHaveBeenCalledWith({ cwd: '/project/dir' });
  });
});

// ---- setAgentDisabled ----

describe('setAgentDisabled', () => {
  it('calls settings.setAgentDisabled with empty cwd when no cwd provided', async () => {
    mockSettings.setAgentDisabled.mockResolvedValue(undefined);
    await setAgentDisabled('explore', true);
    expect(mockSettings.setAgentDisabled).toHaveBeenCalledWith({
      name: 'explore',
      disabled: true,
      cwd: '',
    });
  });

  it('calls settings.setAgentDisabled with provided cwd', async () => {
    mockSettings.setAgentDisabled.mockResolvedValue(undefined);
    await setAgentDisabled('explore', false, '/project/dir');
    expect(mockSettings.setAgentDisabled).toHaveBeenCalledWith({
      name: 'explore',
      disabled: false,
      cwd: '/project/dir',
    });
  });
});

// ---- resetAgentDisabled ----

describe('resetAgentDisabled', () => {
  it('calls settings.resetAgentDisabled with name and cwd', async () => {
    mockSettings.resetAgentDisabled.mockResolvedValue(undefined);
    await resetAgentDisabled('explore', '/project/dir');
    expect(mockSettings.resetAgentDisabled).toHaveBeenCalledWith({
      name: 'explore',
      cwd: '/project/dir',
    });
  });
});

// ---- setMcpDisabled ----

describe('setMcpDisabled', () => {
  it('calls settings.setMcpDisabled with empty cwd when no cwd provided', async () => {
    mockSettings.setMcpDisabled.mockResolvedValue(undefined);
    await setMcpDisabled('mcp-server', true);
    expect(mockSettings.setMcpDisabled).toHaveBeenCalledWith({
      name: 'mcp-server',
      disabled: true,
      cwd: '',
    });
  });

  it('calls settings.setMcpDisabled with provided cwd', async () => {
    mockSettings.setMcpDisabled.mockResolvedValue(undefined);
    await setMcpDisabled('mcp-server', false, '/project/dir');
    expect(mockSettings.setMcpDisabled).toHaveBeenCalledWith({
      name: 'mcp-server',
      disabled: false,
      cwd: '/project/dir',
    });
  });
});

// ---- resetMcpDisabled ----

describe('resetMcpDisabled', () => {
  it('calls settings.resetMcpDisabled with name and cwd', async () => {
    mockSettings.resetMcpDisabled.mockResolvedValue(undefined);
    await resetMcpDisabled('mcp-server', '/project/dir');
    expect(mockSettings.resetMcpDisabled).toHaveBeenCalledWith({
      name: 'mcp-server',
      cwd: '/project/dir',
    });
  });
});

// ---- setHookDisabled ----

describe('setHookDisabled', () => {
  it('calls settings.setHookDisabled with provided cwd', async () => {
    mockSettings.setHookDisabled.mockResolvedValue(undefined);
    await setHookDisabled('/project/dir', 'my-hook', true);
    expect(mockSettings.setHookDisabled).toHaveBeenCalledWith({
      cwd: '/project/dir',
      name: 'my-hook',
      disabled: true,
    });
  });

  it('calls settings.setHookDisabled with empty string when cwd is undefined', async () => {
    mockSettings.setHookDisabled.mockResolvedValue(undefined);
    await setHookDisabled(undefined, 'my-hook', false);
    expect(mockSettings.setHookDisabled).toHaveBeenCalledWith({
      cwd: '',
      name: 'my-hook',
      disabled: false,
    });
  });
});

// ---- resetHookDisabled ----

describe('resetHookDisabled', () => {
  it('calls settings.resetHookDisabled with name and cwd', async () => {
    mockSettings.resetHookDisabled.mockResolvedValue(undefined);
    await resetHookDisabled('my-hook', '/project/dir');
    expect(mockSettings.resetHookDisabled).toHaveBeenCalledWith({
      name: 'my-hook',
      cwd: '/project/dir',
    });
  });
});

// ---- toggleSkill ----

describe('toggleSkill', () => {
  it('calls settings.toggleSkill with empty cwd when no cwd provided', async () => {
    mockSettings.toggleSkill.mockResolvedValue(undefined);
    await toggleSkill('my-skill', true);
    expect(mockSettings.toggleSkill).toHaveBeenCalledWith({
      name: 'my-skill',
      enabled: true,
      cwd: '',
    });
  });

  it('calls settings.toggleSkill with provided cwd', async () => {
    mockSettings.toggleSkill.mockResolvedValue(undefined);
    await toggleSkill('my-skill', false, '/project/dir');
    expect(mockSettings.toggleSkill).toHaveBeenCalledWith({
      name: 'my-skill',
      enabled: false,
      cwd: '/project/dir',
    });
  });
});

// ---- New config API functions ----

describe('getMemoryConfig', () => {
  it('calls clients.settings.getMemoryConfig', async () => {
    mockSettings.getMemoryConfig.mockResolvedValue({ enabled: false, types: [], model: '' });
    const result = await getMemoryConfig();
    expect(mockSettings.getMemoryConfig).toHaveBeenCalled();
    expect(result).toEqual({ enabled: false, types: [], model: '' });
  });
});

describe('setMemoryModel', () => {
  it('calls clients.settings.setMemoryModel', async () => {
    mockSettings.setMemoryModel.mockResolvedValue({ model: 'gpt-4o' });
    await setMemoryModel('gpt-4o');
    expect(mockSettings.setMemoryModel).toHaveBeenCalledWith('gpt-4o');
  });
});

describe('getAgentConfig', () => {
  it('calls clients.settings.getAgentConfig', async () => {
    mockSettings.getAgentConfig.mockResolvedValue({ maxSteps: 200, maxStopContinuations: 2 });
    const result = await getAgentConfig();
    expect(mockSettings.getAgentConfig).toHaveBeenCalled();
    expect(result.maxSteps).toBe(200);
  });
});

describe('setAgentConfig', () => {
  it('calls api with maxSteps', async () => {
    mockApi.mockResolvedValue({ maxSteps: 500, maxStopContinuations: 2 });
    await setAgentConfig({ maxSteps: 500 });
    expect(mockApi).toHaveBeenCalledWith('/api/settings/agent/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxSteps: 500 }),
    });
  });
});

describe('setCompactionModel', () => {
  it('calls clients.settings.setCompactionModel', async () => {
    mockSettings.setCompactionModel.mockResolvedValue({ compactionModel: 'gpt-4o-mini' });
    await setCompactionModel('gpt-4o-mini');
    expect(mockSettings.setCompactionModel).toHaveBeenCalledWith('gpt-4o-mini');
  });
});

// ---- Plan file API ----

describe('getSessionPlan', () => {
  it('calls clients.sessions.getSessionPlan with sessionId and cwd', async () => {
    mockSessions.getSessionPlan.mockResolvedValue({
      content: '',
      path: '/x',
      directory: '/x',
      exists: false,
    });
    await getSessionPlan('s-1', '/some path with space');
    expect(mockSessions.getSessionPlan).toHaveBeenCalledWith({
      sessionId: 's-1',
      cwd: '/some path with space',
    });
  });
});

// ---- Mode switching API ----

describe('getSessionMode', () => {
  it('delegates to clients.sessions.getSessionMode', async () => {
    mockSessions.getSessionMode.mockResolvedValue({
      mode: 'build',
      permissionMode: 'default',
      cwd: '/tmp',
      available: [],
    });
    const result = await getSessionMode('s-1', '/tmp');
    expect(mockSessions.getSessionMode).toHaveBeenCalledWith({
      sessionId: 's-1',
      cwd: '/tmp',
    });
    expect(result.mode).toBe('build');
  });
});

describe('setSessionMode', () => {
  it('delegates to clients.sessions.setSessionMode', async () => {
    mockSessions.setSessionMode.mockResolvedValue({ mode: 'plan', permissionMode: 'default' });
    await setSessionMode('s-1', '/tmp', 'plan');
    expect(mockSessions.setSessionMode).toHaveBeenCalledWith({
      sessionId: 's-1',
      cwd: '/tmp',
      mode: 'plan',
    });
  });
});
