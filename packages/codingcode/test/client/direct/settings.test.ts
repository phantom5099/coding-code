import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createDirectSettingsClient } from '../../../src/client/direct/settings.js';

vi.mock('../../../src/mcp/index.js', () => ({
  McpService: {} as any,
}));

vi.mock('../../../src/skills/index.js', () => ({
  SkillService: {} as any,
}));

vi.mock('../../../src/approval/index.js', () => ({
  getGlobalPermissionMode: vi.fn().mockReturnValue('auto'),
  setGlobalPermissionMode: vi.fn(),
}));

vi.mock('../../../src/mcp/config.js', () => ({
  loadMcpConfig: vi.fn().mockReturnValue([]),
  writeMcpConfig: vi.fn(),
  resolveMcpDisabled: vi.fn().mockReturnValue(false),
  setGlobalMcpDisabledState: vi.fn(),
  setProjectMcpDisabledState: vi.fn(),
  resetProjectMcpDisabledState: vi.fn(),
}));

vi.mock('../../../src/subagent/loader.js', () => ({
  loadAgentProfiles: vi.fn().mockReturnValue([]),
  writeAgentProfile: vi.fn(),
  updateAgentProfile: vi.fn(),
  deleteAgentProfile: vi.fn(),
}));

vi.mock('../../../src/subagent/registry.js', () => ({
  EXPLORE_PROFILE: {
    name: 'explore',
    description: 'Explore',
    tools: ['read_file'],
    readonly: true,
    maxSteps: 30,
  },
  setSubagentEnabledState: vi.fn(),
  resolveSubagentEnabled: vi.fn().mockReturnValue(true),
  getProjectSubagentEnabledState: vi.fn().mockReturnValue(undefined),
  setProjectSubagentEnabledState: vi.fn(),
  resetProjectSubagentEnabledState: vi.fn(),
  setGlobalAgentDisabledState: vi.fn(),
  setProjectAgentDisabledState: vi.fn(),
  resetProjectAgentDisabledState: vi.fn(),
  resolveAgentDisabled: vi.fn().mockReturnValue(false),
  getProjectAgentDisabledState: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../src/hooks/config.js', () => ({
  loadHookConfigs: vi.fn().mockReturnValue([]),
  writeHookConfigs: vi.fn(),
  resolveHookDisabled: vi.fn().mockReturnValue(false),
  setGlobalHookDisabledState: vi.fn(),
  setProjectHookDisabledState: vi.fn(),
  resetProjectHookDisabledState: vi.fn(),
}));

vi.mock('../../../src/hooks/executor.js', () => ({
  setHookRuntimeEnabled: vi.fn(),
}));

vi.mock('../../../src/memory/config.js', () => ({
  getMemoryConfig: vi.fn().mockReturnValue({ enabled: true, disabledTypes: [], extraTypes: [] }),
  getAllTypesWithStatus: vi.fn().mockReturnValue([]),
  setMemoryTypeDisabled: vi.fn(),
  addMemoryExtraType: vi.fn(),
  updateMemoryExtraType: vi.fn(),
  deleteMemoryExtraType: vi.fn(),
}));

vi.mock('../../../src/memory/index.js', () => ({
  getMemoryEnabled: vi.fn().mockReturnValue(true),
  setMemoryEnabled: vi.fn(),
}));

vi.mock('../../../src/core/error.js', () => ({
  AlreadyExistsError: class AlreadyExistsError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'AlreadyExistsError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
}));

const mockRunWithLayer = vi.fn().mockResolvedValue(undefined);

describe('createDirectSettingsClient - reset APIs', () => {
  let client: ReturnType<typeof createDirectSettingsClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createDirectSettingsClient(mockRunWithLayer);
  });

  describe('resetSubagentEnabled', () => {
    it('calls resetProjectSubagentEnabledState with cwd', async () => {
      const { resetProjectSubagentEnabledState } =
        await import('../../../src/subagent/registry.js');
      await client.resetSubagentEnabled({ cwd: '/my-project' });
      expect(resetProjectSubagentEnabledState).toHaveBeenCalledWith('/my-project');
    });
  });

  describe('resetAgentDisabled', () => {
    it('calls resetProjectAgentDisabledState with cwd and name', async () => {
      const { resetProjectAgentDisabledState } = await import('../../../src/subagent/registry.js');
      await client.resetAgentDisabled({ name: 'my-agent', cwd: '/my-project' });
      expect(resetProjectAgentDisabledState).toHaveBeenCalledWith('/my-project', 'my-agent');
    });
  });

  describe('resetMcpDisabled', () => {
    it('calls resetProjectMcpDisabledState with cwd and name', async () => {
      const { resetProjectMcpDisabledState } = await import('../../../src/mcp/config.js');
      await client.resetMcpDisabled({ name: 'my-server', cwd: '/my-project' });
      expect(resetProjectMcpDisabledState).toHaveBeenCalledWith('/my-project', 'my-server');
    });
  });

  describe('resetHookDisabled', () => {
    it('calls resetProjectHookDisabledState with cwd and name', async () => {
      const { resetProjectHookDisabledState } = await import('../../../src/hooks/config.js');
      await client.resetHookDisabled({ name: 'my-hook', cwd: '/my-project' });
      expect(resetProjectHookDisabledState).toHaveBeenCalledWith('/my-project', 'my-hook');
    });
  });
});

describe('createDirectSettingsClient - updated signatures with cwd', () => {
  let client: ReturnType<typeof createDirectSettingsClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createDirectSettingsClient(mockRunWithLayer);
  });

  describe('getSubagentEnabled', () => {
    it('returns enabled and source from resolveSubagentEnabled', async () => {
      const { resolveSubagentEnabled, getProjectSubagentEnabledState } =
        await import('../../../src/subagent/registry.js');
      vi.mocked(resolveSubagentEnabled).mockReturnValue(true);
      vi.mocked(getProjectSubagentEnabledState).mockReturnValue(undefined);
      const result = await client.getSubagentEnabled({ cwd: '/my-project' });
      expect(result).toEqual({ enabled: true, source: 'global' });
      expect(resolveSubagentEnabled).toHaveBeenCalledWith('/my-project');
    });

    it('returns source=project when project override exists', async () => {
      const { resolveSubagentEnabled, getProjectSubagentEnabledState } =
        await import('../../../src/subagent/registry.js');
      vi.mocked(resolveSubagentEnabled).mockReturnValue(false);
      vi.mocked(getProjectSubagentEnabledState).mockReturnValue(false);
      const result = await client.getSubagentEnabled({ cwd: '/my-project' });
      expect(result).toEqual({ enabled: false, source: 'project' });
    });
  });

  describe('setSubagentEnabled', () => {
    it('calls setSubagentEnabledState for global cwd', async () => {
      const { setSubagentEnabledState } = await import('../../../src/subagent/registry.js');
      await client.setSubagentEnabled({ enabled: false, cwd: 'global' });
      expect(setSubagentEnabledState).toHaveBeenCalledWith(false);
    });

    it('calls setProjectSubagentEnabledState for project cwd', async () => {
      const { setProjectSubagentEnabledState } = await import('../../../src/subagent/registry.js');
      await client.setSubagentEnabled({ enabled: false, cwd: '/my-project' });
      expect(setProjectSubagentEnabledState).toHaveBeenCalledWith('/my-project', false);
    });
  });

  describe('setAgentDisabled', () => {
    it('calls setGlobalAgentDisabledState for global cwd', async () => {
      const { setGlobalAgentDisabledState } = await import('../../../src/subagent/registry.js');
      await client.setAgentDisabled({ name: 'my-agent', disabled: true, cwd: 'global' });
      expect(setGlobalAgentDisabledState).toHaveBeenCalledWith('my-agent', true);
    });

    it('calls setProjectAgentDisabledState for project cwd', async () => {
      const { setProjectAgentDisabledState } = await import('../../../src/subagent/registry.js');
      await client.setAgentDisabled({ name: 'my-agent', disabled: true, cwd: '/my-project' });
      expect(setProjectAgentDisabledState).toHaveBeenCalledWith('/my-project', 'my-agent', true);
    });
  });

  describe('setMcpDisabled', () => {
    it('calls setGlobalMcpDisabledState for global cwd', async () => {
      const { setGlobalMcpDisabledState } = await import('../../../src/mcp/config.js');
      await client.setMcpDisabled({ name: 'my-server', disabled: true, cwd: 'global' });
      expect(setGlobalMcpDisabledState).toHaveBeenCalledWith('my-server', true);
    });

    it('calls setProjectMcpDisabledState for project cwd', async () => {
      const { setProjectMcpDisabledState } = await import('../../../src/mcp/config.js');
      await client.setMcpDisabled({ name: 'my-server', disabled: true, cwd: '/my-project' });
      expect(setProjectMcpDisabledState).toHaveBeenCalledWith('/my-project', 'my-server', true);
    });
  });

  describe('setHookDisabled', () => {
    it('calls setGlobalHookDisabledState for global cwd', async () => {
      const { setGlobalHookDisabledState } = await import('../../../src/hooks/config.js');
      await client.setHookDisabled({ cwd: 'global', name: 'my-hook', disabled: true });
      expect(setGlobalHookDisabledState).toHaveBeenCalledWith('my-hook', true);
    });

    it('calls setProjectHookDisabledState for project cwd', async () => {
      const { setProjectHookDisabledState } = await import('../../../src/hooks/config.js');
      await client.setHookDisabled({ cwd: '/my-project', name: 'my-hook', disabled: true });
      expect(setProjectHookDisabledState).toHaveBeenCalledWith('/my-project', 'my-hook', true);
    });
  });

  describe('toggleSkill', () => {
    it('passes cwd to SkillService via runWithLayer', async () => {
      mockRunWithLayer.mockResolvedValue(undefined);
      await client.toggleSkill({ name: 'my-skill', enabled: true, cwd: '/my-project' });
      expect(mockRunWithLayer).toHaveBeenCalled();
    });
  });
});
