import { describe, it, expect, vi } from 'vitest';
import { settingsRouter } from '../../src/server/routes/settings.js';

vi.mock('../../src/memory/config.js', () => ({
  getMemoryConfig: vi.fn().mockReturnValue({ enabled: true, disabledTypes: [], extraTypes: [] }),
  getAllTypesWithStatus: vi.fn().mockReturnValue([{ name: 'builtin', description: 'Built-in', isBuiltIn: true, disabled: false }]),
  setMemoryTypeDisabled: vi.fn(),
  addMemoryExtraType: vi.fn(),
  updateMemoryExtraType: vi.fn(),
  deleteMemoryExtraType: vi.fn(),
}));

vi.mock('../../src/memory/index.js', () => {
  let enabled = true;
  return {
    getMemoryEnabled: vi.fn().mockImplementation(() => enabled),
    setMemoryEnabled: vi.fn().mockImplementation((value: boolean) => { enabled = value; }),
  };
});

vi.mock('../../src/subagent/registry.js', () => ({
  EXPLORE_PROFILE: { name: 'explore', description: 'Explore', tools: ['read_file'] },
  isAgentDisabledState: vi.fn().mockReturnValue(false),
  setAgentDisabledState: vi.fn(),
  getSubagentEnabledState: vi.fn().mockReturnValue(true),
  setSubagentEnabledState: vi.fn(),
}));

vi.mock('../../src/mcp/config.js', () => ({
  loadMcpConfig: vi.fn().mockReturnValue([]),
  writeMcpConfig: vi.fn(),
}));

vi.mock('../../src/subagent/loader.js', () => ({
  loadAgentProfiles: vi.fn().mockReturnValue([]),
  writeAgentProfile: vi.fn(),
  updateAgentProfile: vi.fn(),
  deleteAgentProfile: vi.fn(),
}));

vi.mock('../../src/hooks/config.js', () => ({
  loadHookConfigs: vi.fn().mockReturnValue([]),
  writeHookConfigs: vi.fn(),
}));

vi.mock('../../src/hooks/executor.js', () => ({
  setHookRuntimeEnabled: vi.fn(),
}));

vi.mock('../../src/mcp/index.js', () => ({
  McpService: {} as any,
}));

vi.mock('../../src/skills/index.js', () => ({
  SkillService: {} as any,
}));

vi.mock('../../src/core/workspace.js', () => ({
  resolveWorkspaceCwd: vi.fn((cwd?: string) => cwd ?? '/default'),
}));

describe('GET /memory/config', () => {
  it('returns memory config with types', async () => {
    const res = await settingsRouter.request('/memory/config');
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean; types: any[] };
    expect(body.enabled).toBe(true);
    expect(body.types).toHaveLength(1);
    expect(body.types[0]!.name).toBe('builtin');
  });
});

describe('POST /memory/enabled', () => {
  it('toggles memory enabled and returns state', async () => {
    const res = await settingsRouter.request('/memory/enabled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });
});

describe('POST /memory/extra-type', () => {
  it('returns 409 when type already exists', async () => {
    const { addMemoryExtraType } = await import('../../src/memory/config.js');
    vi.mocked(addMemoryExtraType).mockImplementation(() => {
      throw new Error("Memory type 'dup' already exists");
    });
    const res = await settingsRouter.request('/memory/extra-type', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup', description: 'duplicate' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('already exists');
  });
});

describe('PUT /memory/extra-type/:name', () => {
  it('returns 404 when type not found', async () => {
    const { updateMemoryExtraType } = await import('../../src/memory/config.js');
    vi.mocked(updateMemoryExtraType).mockImplementation(() => {
      throw new Error("Memory type 'missing' not found");
    });
    const res = await settingsRouter.request('/memory/extra-type/missing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'missing', description: 'x' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('not found');
  });
});

describe('GET /subagent/enabled', () => {
  it('returns enabled state', async () => {
    const res = await settingsRouter.request('/subagent/enabled');
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean };
    expect(body.enabled).toBe(true);
  });
});

describe('POST /subagent/enabled', () => {
  it('updates enabled state', async () => {
    const res = await settingsRouter.request('/subagent/enabled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
