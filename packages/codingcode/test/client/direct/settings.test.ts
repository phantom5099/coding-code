import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createDirectSettingsClient } from '../../../src/direct/settings.js';
import { SkillService } from '../../../src/skills/service.js';
import { MemoryService } from '../../../src/memory/index.js';
import { McpService } from '../../../src/mcp/index.js';
import { ApprovalService } from '../../../src/approval/index.js';
import { ApprovalWaitService } from '../../../src/approval/async-confirm.js';
import { HookService } from '../../../src/hooks/registry.js';

const mockEnableSkill = vi.fn(() => Effect.void);
const mockDisableSkill = vi.fn(() => Effect.void);
const mockListWithStatus = vi.fn(() => Effect.succeed([]));

const MockSkillLayer = Layer.succeed(
  SkillService,
  SkillService.make({
    getAll: (_p: string) => Effect.succeed([]),
    findByName: (_p: string, _n: string) => Effect.succeed(undefined),
    select: (_p: string, _q: string) => Effect.succeed(undefined),
    selectImplicit: (_p: string, _q: string, _m: any) => Effect.succeed(undefined),
    extractSkill: (_p: string, _q: string) => Effect.succeed([undefined, '']),
    enableSkill: mockEnableSkill,
    disableSkill: mockDisableSkill,
    listWithStatus: mockListWithStatus,
    evictProject: (_p: string) => Effect.void,
  })
);

const MockMemoryLayer = Layer.succeed(MemoryService, {
  getMemoryEnabled: () => true,
  setMemoryEnabled: () => {},
  loadMemoryForPrompt: () => '',
  flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
} as any);

const MockMcpLayer = Layer.succeed(McpService, {
  syncConnections: () => Effect.void,
  connectServers: () => Effect.void,
  disconnectServers: () => Effect.void,
  getServerToolNames: () => [],
  disconnectAll: () => Effect.void,
  status: () => Effect.succeed([]),
  listProjectMcpTools: () => [],
  disable: () => Effect.void,
  enable: () => Effect.void,
} as any);

const MockApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookService.Default, ApprovalWaitService.Default))
);

const TestLayer = Layer.mergeAll(
  MockSkillLayer,
  MockMemoryLayer,
  MockMcpLayer,
  MockApprovalLayer,
  HookService.Default,
  ApprovalWaitService.Default
);

const rt = ManagedRuntime.make(TestLayer);

vi.mock('../../../src/mcp/config.js', () => ({
  loadMcpConfig: vi.fn().mockReturnValue([]),
  writeMcpConfig: vi.fn(),
  loadGlobalMcpConfig: vi.fn().mockReturnValue([]),
  writeGlobalMcpConfig: vi.fn(),
  resolveMcpDisabled: vi.fn().mockReturnValue(false),
  resolveMcpConfig: vi.fn().mockReturnValue([]),
  getGlobalMcpDisabledState: vi.fn().mockReturnValue(false),
  setGlobalMcpDisabledState: vi.fn(),
  setProjectMcpDisabledState: vi.fn(),
  resetProjectMcpDisabledState: vi.fn(),
}));

vi.mock('../../../src/subagent/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/subagent/loader.js')>();
  return {
    loadAgentProfiles: vi.fn().mockReturnValue([]),
    writeAgentProfile: vi.fn(),
    updateAgentProfile: vi.fn(),
    deleteAgentProfile: vi.fn().mockImplementation(actual.deleteAgentProfile),
    loadGlobalAgentProfiles: vi.fn().mockReturnValue([]),
    writeGlobalAgentProfile: vi.fn(),
    updateGlobalAgentProfile: vi.fn(),
    deleteGlobalAgentProfile: vi.fn(),
  };
});

vi.mock('../../../src/subagent/registry.js', () => ({
  EXPLORE_PROFILE: {
    name: 'explore',
    description: 'Explore',
    tools: ['read_file'],
    readonly: true,
    maxSteps: 30,
  },
  PLAN_PROFILE: {
    name: 'plan',
    description: 'Plan',
    tools: ['read_file'],
    readonly: true,
    maxSteps: 30,
  },
  setSubagentEnabledState: vi.fn(),
  resolveSubagentEnabled: vi.fn().mockReturnValue(true),
  getProjectSubagentEnabledState: vi.fn().mockReturnValue(undefined),
  setProjectSubagentEnabledState: vi.fn(),
  resetProjectSubagentEnabledState: vi.fn(),
  getGlobalAgentDisabledState: vi.fn().mockReturnValue(false),
  setGlobalAgentDisabledState: vi.fn(),
  setProjectAgentDisabledState: vi.fn(),
  resetProjectAgentDisabledState: vi.fn(),
  resolveAgentDisabled: vi.fn().mockReturnValue(false),
  getProjectAgentDisabledState: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../src/hooks/config.js', () => ({
  loadHookConfigs: vi.fn().mockReturnValue([]),
  writeHookConfigs: vi.fn(),
  loadGlobalHookConfigs: vi.fn().mockReturnValue([]),
  writeGlobalHookConfigs: vi.fn(),
  resolveHookConfigs: vi.fn().mockReturnValue([]),
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

describe('createDirectSettingsClient - reset APIs', () => {
  let client: ReturnType<typeof createDirectSettingsClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createDirectSettingsClient(rt);
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
    client = createDirectSettingsClient(rt);
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
    it('calls enableSkill with correct args', async () => {
      mockEnableSkill.mockClear();
      await client.toggleSkill({ name: 'my-skill', enabled: true, cwd: '/my-project' });
      expect(mockEnableSkill).toHaveBeenCalledWith('/my-project', 'my-skill');
    });

    it('calls disableSkill with correct args', async () => {
      mockDisableSkill.mockClear();
      await client.toggleSkill({ name: 'my-skill', enabled: false, cwd: '/my-project' });
      expect(mockDisableSkill).toHaveBeenCalledWith('/my-project', 'my-skill');
    });
  });
});

// ---- Merged view: agents / hooks / MCP source labeling ----

describe('createDirectSettingsClient - merged views with source labeling', () => {
  let client: ReturnType<typeof createDirectSettingsClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createDirectSettingsClient(rt);
  });

  describe('listAgents', () => {
    it('global cwd returns builtin (explore+plan) + global custom, all source labeled', async () => {
      const { loadGlobalAgentProfiles } = await import('../../../src/subagent/loader.js');
      vi.mocked(loadGlobalAgentProfiles).mockReturnValue([
        { name: 'g1', description: 'G1', tools: ['read_file'] },
        { name: 'g2', description: 'G2', tools: ['read_file'] },
      ] as any);
      const result = await client.listAgents({ cwd: 'global' });
      expect(result).toHaveLength(4);
      expect(result.find((a: any) => a.name === 'explore')?.source).toBe('builtin');
      expect(result.find((a: any) => a.name === 'plan')?.source).toBe('builtin');
      expect(result.find((a: any) => a.name === 'g1')?.source).toBe('global');
      expect(result.find((a: any) => a.name === 'g2')?.source).toBe('global');
    });

    it('project cwd returns builtin + global (deduped) + project, project override labeled source=project', async () => {
      const { loadGlobalAgentProfiles, loadAgentProfiles } =
        await import('../../../src/subagent/loader.js');
      vi.mocked(loadGlobalAgentProfiles).mockReturnValue([
        { name: 'shared', description: 'shared', tools: ['read_file'] },
        { name: 'global-only', description: 'G only', tools: ['read_file'] },
      ] as any);
      vi.mocked(loadAgentProfiles).mockReturnValue([
        { name: 'shared', description: 'shared override', tools: ['read_file'] },
        { name: 'project-only', description: 'P only', tools: ['read_file'] },
      ] as any);
      const result = await client.listAgents({ cwd: '/my-project' });
      const byName = new Map(result.map((a: any) => [a.name, a]));
      expect(byName.get('explore')?.source).toBe('builtin');
      expect(byName.get('plan')?.source).toBe('builtin');
      expect(byName.get('global-only')?.source).toBe('global');
      // Override case: project's copy wins, labeled source=project
      expect(byName.get('shared')?.source).toBe('project');
      expect(byName.get('shared')?.hasProjectOverride).toBe(true);
      expect(byName.get('project-only')?.source).toBe('project');
    });
  });

  describe('listHooks', () => {
    it('global cwd returns global hooks with source=global', async () => {
      const { loadGlobalHookConfigs } = await import('../../../src/hooks/config.js');
      vi.mocked(loadGlobalHookConfigs).mockReturnValue([
        {
          name: 'gh',
          point: 'tool.execute.before',
          type: 'observer',
          command: 'echo',
          enabled: true,
        },
      ] as any);
      const result = (await client.listHooks({ cwd: 'global' })) as any[];
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('global');
    });

    it('project cwd returns merged hooks; project override labeled source=project', async () => {
      const { loadGlobalHookConfigs, loadHookConfigs, resolveHookConfigs } =
        await import('../../../src/hooks/config.js');
      vi.mocked(loadGlobalHookConfigs).mockReturnValue([
        {
          name: 'shared',
          point: 'tool.execute.before',
          type: 'observer',
          command: 'echo',
          enabled: true,
        },
        {
          name: 'gh',
          point: 'tool.execute.before',
          type: 'observer',
          command: 'echo',
          enabled: true,
        },
      ] as any);
      vi.mocked(loadHookConfigs).mockReturnValue([
        {
          name: 'shared',
          point: 'tool.execute.before',
          type: 'observer',
          command: 'sh',
          enabled: true,
        },
        { name: 'ph', point: 'tool.execute.after', type: 'decision', command: 'sh', enabled: true },
      ] as any);
      vi.mocked(resolveHookConfigs).mockReturnValue([
        {
          name: 'shared',
          point: 'tool.execute.before',
          type: 'observer',
          command: 'sh',
          enabled: true,
        },
        {
          name: 'gh',
          point: 'tool.execute.before',
          type: 'observer',
          command: 'echo',
          enabled: true,
        },
        { name: 'ph', point: 'tool.execute.after', type: 'decision', command: 'sh', enabled: true },
      ] as any);
      const result = (await client.listHooks({ cwd: '/my-project' })) as any[];
      const byName = new Map(result.map((h) => [h.name, h]));
      expect(byName.get('shared')?.source).toBe('project');
      expect(byName.get('shared')?.hasProjectOverride).toBe(true);
      expect(byName.get('gh')?.source).toBe('global');
      expect(byName.get('ph')?.source).toBe('project');
    });
  });

  describe('getMcpStatus', () => {
    it('global cwd returns global servers with source=global', async () => {
      const { loadGlobalMcpConfig, getGlobalMcpDisabledState } =
        await import('../../../src/mcp/config.js');
      vi.mocked(loadGlobalMcpConfig).mockReturnValue([{ name: 'gs', command: 'npx' }] as any);
      vi.mocked(getGlobalMcpDisabledState).mockReturnValue(false);
      const result = (await client.getMcpStatus({ cwd: 'global' })) as any[];
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('global');
      expect(result[0].name).toBe('gs');
    });

    it('project cwd returns merged servers; project override labeled source=project', async () => {
      const { loadGlobalMcpConfig, loadMcpConfig } = await import('../../../src/mcp/config.js');
      vi.mocked(loadGlobalMcpConfig).mockReturnValue([
        { name: 'shared', command: 'global-cmd' },
        { name: 'gs', command: 'npx' },
      ] as any);
      vi.mocked(loadMcpConfig).mockReturnValue([
        { name: 'shared', command: 'project-cmd' },
        { name: 'ps', command: 'node' },
      ] as any);
      const result = (await client.getMcpStatus({ cwd: '/my-project' })) as any[];
      const byName = new Map(result.map((s) => [s.name, s]));
      expect(byName.get('shared')?.source).toBe('project');
      expect(byName.get('shared')?.hasProjectOverride).toBe(true);
      expect(byName.get('gs')?.source).toBe('global');
      expect(byName.get('ps')?.source).toBe('project');
    });
  });
});

// ---- CRUD: global vs project branching ----

describe('createDirectSettingsClient - CRUD branches on global cwd', () => {
  let client: ReturnType<typeof createDirectSettingsClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createDirectSettingsClient(rt);
  });

  it('createAgent on global cwd calls writeGlobalAgentProfile', async () => {
    const { writeGlobalAgentProfile } = await import('../../../src/subagent/loader.js');
    await client.createAgent({
      cwd: 'global',
      profile: { name: 'new', description: 'New', systemPrompt: 'sp' } as any,
    });
    expect(writeGlobalAgentProfile).toHaveBeenCalledWith({
      name: 'new',
      description: 'New',
      systemPrompt: 'sp',
    });
  });

  it('updateAgent on global cwd calls updateGlobalAgentProfile', async () => {
    const { loadGlobalAgentProfiles, updateGlobalAgentProfile } =
      await import('../../../src/subagent/loader.js');
    vi.mocked(loadGlobalAgentProfiles).mockReturnValue([
      { name: 'old', description: 'Old' },
    ] as any);
    await client.updateAgent({
      cwd: 'global',
      name: 'old',
      profile: { name: 'old', description: 'Updated' } as any,
    });
    expect(updateGlobalAgentProfile).toHaveBeenCalledWith('old', {
      name: 'old',
      description: 'Updated',
    });
  });

  it('deleteAgent on global cwd calls deleteGlobalAgentProfile', async () => {
    const { deleteGlobalAgentProfile } = await import('../../../src/subagent/loader.js');
    await client.deleteAgent({ cwd: 'global', name: 'g1' });
    expect(deleteGlobalAgentProfile).toHaveBeenCalledWith('g1');
  });

  it('createMcpServer on global cwd calls writeGlobalMcpConfig', async () => {
    const { loadGlobalMcpConfig, writeGlobalMcpConfig } =
      await import('../../../src/mcp/config.js');
    vi.mocked(loadGlobalMcpConfig).mockReturnValue([{ name: 'existing', command: 'npx' }]);
    await client.createMcpServer({
      cwd: 'global',
      server: { name: 'new', command: 'node' } as any,
    });
    expect(writeGlobalMcpConfig).toHaveBeenCalledWith([
      { name: 'existing', command: 'npx' },
      { name: 'new', command: 'node' },
    ]);
  });

  it('deleteHook on global cwd calls writeGlobalHookConfigs', async () => {
    const { loadGlobalHookConfigs, writeGlobalHookConfigs } =
      await import('../../../src/hooks/config.js');
    vi.mocked(loadGlobalHookConfigs).mockReturnValue([
      {
        name: 'g1',
        point: 'tool.execute.before',
        type: 'observer',
        command: 'echo',
        enabled: true,
      },
      {
        name: 'g2',
        point: 'tool.execute.before',
        type: 'observer',
        command: 'echo',
        enabled: true,
      },
    ] as any);
    await client.deleteHook({ cwd: 'global', name: 'g1' });
    expect(writeGlobalHookConfigs).toHaveBeenCalledWith([
      {
        name: 'g2',
        point: 'tool.execute.before',
        type: 'observer',
        command: 'echo',
        enabled: true,
      },
    ]);
  });
});
