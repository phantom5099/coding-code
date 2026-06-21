import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockApi, mockAgent } = vi.hoisted(() => {
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
  };
  const mockApi = vi.fn();
  const mockAgent = {
    sendApprovalResponse: vi.fn(),
    sendPlanApprovalResponse: vi.fn(),
  };
  return { mockSettings, mockApi, mockAgent };
});

vi.mock('../src/lib/api', () => ({
  API_BASE: 'http://localhost:3000',
  api: mockApi,
}));

vi.mock('@codingcode/core/client/http-clients', () => ({
  createHttpClients: () => ({
    settings: mockSettings,
    models: { listModels: vi.fn(), switchModel: vi.fn() },
    sessions: { listSessions: vi.fn() },
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
  sendPlanApproval,
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
  it('calls api with correct path', async () => {
    mockApi.mockResolvedValue({ enabled: false, types: [], model: '' });
    await getMemoryConfig();
    expect(mockApi).toHaveBeenCalledWith('/api/settings/memory/config');
  });
});

describe('setMemoryModel', () => {
  it('calls api with correct POST body', async () => {
    mockApi.mockResolvedValue({ model: 'gpt-4o' });
    await setMemoryModel('gpt-4o');
    expect(mockApi).toHaveBeenCalledWith('/api/settings/memory/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o' }),
    });
  });
});

describe('getAgentConfig', () => {
  it('calls api with correct path', async () => {
    mockApi.mockResolvedValue({ maxSteps: 200, maxStopContinuations: 2 });
    await getAgentConfig();
    expect(mockApi).toHaveBeenCalledWith('/api/settings/agent/config');
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
  it('calls api with compactionModel', async () => {
    mockApi.mockResolvedValue({ compactionModel: 'gpt-4o-mini' });
    await setCompactionModel('gpt-4o-mini');
    expect(mockApi).toHaveBeenCalledWith('/api/settings/context/compaction-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compactionModel: 'gpt-4o-mini' }),
    });
  });
});

// ---- Plan approval helpers ----

describe('sendPlanApproval', () => {
  it('serializes "allow" decision as JSON envelope to plan-approval route', async () => {
    mockAgent.sendPlanApprovalResponse.mockResolvedValue(undefined);
    await sendPlanApproval('s-1', 'c-1', { type: 'allow' });
    expect(mockAgent.sendPlanApprovalResponse).toHaveBeenCalledWith({
      sessionId: 's-1',
      approvalId: 'c-1',
      response: JSON.stringify({ type: 'allow' }),
    });
  });

  it('serializes "canceled" decision as JSON envelope to plan-approval route', async () => {
    mockAgent.sendPlanApprovalResponse.mockResolvedValue(undefined);
    await sendPlanApproval('s-1', 'c-1', { type: 'canceled' });
    expect(mockAgent.sendPlanApprovalResponse).toHaveBeenCalledWith({
      sessionId: 's-1',
      approvalId: 'c-1',
      response: JSON.stringify({ type: 'canceled' }),
    });
  });

  it('serializes "modified" with the new input payload to plan-approval route', async () => {
    mockAgent.sendPlanApprovalResponse.mockResolvedValue(undefined);
    await sendPlanApproval('s-1', 'c-1', {
      type: 'modified',
      input: { plan_content: '# new' },
    });
    expect(mockAgent.sendPlanApprovalResponse).toHaveBeenCalledWith({
      sessionId: 's-1',
      approvalId: 'c-1',
      response: JSON.stringify({ type: 'modified', input: { plan_content: '# new' } }),
    });
  });
});

// ---- Plan file API ----

describe('getSessionPlan', () => {
  it('encodes cwd and hits the plan endpoint', async () => {
    mockApi.mockResolvedValue({ content: '', path: '/x', directory: '/x', exists: false });
    await getSessionPlan('s-1', '/some path with space');
    expect(mockApi).toHaveBeenCalledWith(
      '/api/sessions/s-1/plan?cwd=' + encodeURIComponent('/some path with space')
    );
  });
});

// ---- Mode switching API ----

describe('getSessionMode', () => {
  it('encodes cwd and hits the mode GET endpoint', async () => {
    mockApi.mockResolvedValue({
      profileName: 'build',
      permissionMode: 'default',
      cwd: '/tmp',
      available: [],
    });
    await getSessionMode('s-1', '/tmp');
    expect(mockApi).toHaveBeenCalledWith('/api/sessions/s-1/mode?cwd=' + encodeURIComponent('/tmp'));
  });
});

describe('setSessionMode', () => {
  it('POSTs the profile name to the mode endpoint', async () => {
    mockApi.mockResolvedValue({ profileName: 'plan', permissionMode: 'plan' });
    await setSessionMode('s-1', '/tmp', 'plan');
    expect(mockApi).toHaveBeenCalledWith('/api/sessions/s-1/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/tmp', profile: 'plan' }),
    });
  });
});
