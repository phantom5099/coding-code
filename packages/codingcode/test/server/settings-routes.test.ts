import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createSettingsRouter } from '../../src/server/routes/settings.js';
import { MemoryService } from '../../src/memory/index.js';
import { SkillService } from '../../src/skills/service.js';
import { McpService } from '../../src/mcp/index.js';
import { WorkspaceService } from '../../src/core/workspace.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: vi.fn().mockReturnValue({
    maxSteps: 200,
    maxStopContinuations: 2,
    context: { compactionModel: '' },
    memory: {
      enabled: true,
      model: '',
      disabledTypes: [],
      extraTypes: [],
    },
    activeModel: null,
    server: { port: 8080 },
  }),
  updateMaxSteps: vi.fn(),
  updateMaxStopContinuations: vi.fn(),
  updateContextCompactionModel: vi.fn(),
  updateMemoryModel: vi.fn(),
  updateMemoryEnabled: vi.fn(),
  updateMemoryDisabledTypes: vi.fn(),
  updateMemoryExtraTypes: vi.fn(),
}));

vi.mock('../../src/memory/config.js', () => ({
  getMemoryConfig: vi.fn().mockReturnValue({
    enabled: true,
    disabledTypes: [],
    extraTypes: [],
    model: '',
  }),
  getAllTypesWithStatus: vi
    .fn()
    .mockReturnValue([
      { name: 'builtin', description: 'Built-in', isBuiltIn: true, disabled: false },
    ]),
  setMemoryTypeDisabled: vi.fn(),
  addMemoryExtraType: vi.fn(),
  updateMemoryExtraType: vi.fn(),
  deleteMemoryExtraType: vi.fn(),
}));

let memoryEnabled = true;

const MockWorkspaceLayer = Layer.succeed(WorkspaceService, {
  getWorkspaceCwd: () => '/tmp/test',
  resolveWorkspaceCwd: (override?: string) => override ?? '/tmp/test',
  getProcessRoot: () => '/tmp/test',
  getWorkspacePath: () => 'test',
  resolveInWorkspace: (path: string) => `/tmp/test/${path}`,
  getConfig: () => ({ activeModel: null }),
  init: () => {},
} as any);

const MockMemoryLayer = Layer.succeed(MemoryService, {
  getMemoryEnabled: () => memoryEnabled,
  setMemoryEnabled: (v: boolean) => {
    memoryEnabled = v;
  },
  loadMemoryForPrompt: () => '',
  flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
} as any);

const MockSkillLayer = Layer.succeed(SkillService, {
  _tag: 'Skill' as const,
  getAll: vi.fn(() => Effect.succeed([])),
  findByName: vi.fn(() => Effect.succeed(undefined)),
  select: vi.fn(() => Effect.succeed(undefined)),
  selectImplicit: vi.fn(() => Effect.succeed(undefined)),
  extractSkill: vi.fn((_p: string, q: string) =>
    Effect.sync(() => [undefined, q] as [undefined, string])
  ),
  enableSkill: vi.fn(() => Effect.void),
  disableSkill: vi.fn(() => Effect.void),
  listWithStatus: vi.fn(() => Effect.succeed([])),
  evictProject: vi.fn(() => Effect.void),
} as any);

const MockMcpLayer = Layer.succeed(McpService, {
  syncConnections: () => Effect.void,
  connectServers: () => Effect.void,
  disconnectServers: () => Effect.void,
  getServerToolNames: () => [],
  disconnectAll: () => Effect.void,
  status: () => Effect.succeed([]),
  listProjectMcpTools: () => [],
} as any);

const TestLayer = Layer.mergeAll(MockWorkspaceLayer, MockMemoryLayer, MockSkillLayer, MockMcpLayer);

const rt = ManagedRuntime.make(TestLayer);
const settingsRouter = await createSettingsRouter(rt);

vi.mock('../../src/subagent/registry.js', () => ({
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
  resolveSubagentEnabled: vi.fn().mockReturnValue(true),
  getProjectSubagentEnabledState: vi.fn().mockReturnValue(undefined),
  setProjectSubagentEnabledState: vi.fn(),
  resetProjectSubagentEnabledState: vi.fn(),
  getGlobalAgentDisabledState: vi.fn().mockReturnValue(false),
  setGlobalAgentDisabledState: vi.fn(),
  getProjectAgentDisabledState: vi.fn().mockReturnValue(undefined),
  setProjectAgentDisabledState: vi.fn(),
  resetProjectAgentDisabledState: vi.fn(),
  resolveAgentDisabled: vi.fn().mockReturnValue(false),
  getSubagentEnabledState: vi.fn().mockReturnValue(true),
  setSubagentEnabledState: vi.fn(),
}));

vi.mock('../../src/mcp/config.js', () => ({
  loadMcpConfig: vi.fn().mockReturnValue([]),
  writeMcpConfig: vi.fn(),
  loadGlobalMcpConfig: vi.fn().mockReturnValue([]),
  writeGlobalMcpConfig: vi.fn(),
  resolveMcpConfig: vi.fn().mockReturnValue([]),
  resolveMcpDisabled: vi.fn().mockReturnValue(false),
  getGlobalMcpDisabledState: vi.fn().mockReturnValue(false),
  setGlobalMcpDisabledState: vi.fn(),
  setProjectMcpDisabledState: vi.fn(),
  resetProjectMcpDisabledState: vi.fn(),
}));

vi.mock('../../src/subagent/loader.js', () => ({
  loadAgentProfiles: vi.fn().mockReturnValue([]),
  writeAgentProfile: vi.fn(),
  updateAgentProfile: vi.fn(),
  deleteAgentProfile: vi.fn(),
  loadGlobalAgentProfiles: vi.fn().mockReturnValue([]),
  writeGlobalAgentProfile: vi.fn(),
  updateGlobalAgentProfile: vi.fn(),
  deleteGlobalAgentProfile: vi.fn(),
}));

vi.mock('../../src/hooks/config.js', () => ({
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

vi.mock('../../src/hooks/executor.js', () => ({
  setHookRuntimeEnabled: vi.fn(),
}));

vi.mock('../../src/skills/config.js', () => ({
  setGlobalSkillDisabledState: vi.fn(),
  setProjectSkillDisabledState: vi.fn(),
  discoverGlobalSkillDirs: vi.fn().mockReturnValue([]),
  discoverProjectSkillDirs: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/core/workspace.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Context } = require('effect');
  const tag = Context.GenericTag('Workspace') as any;
  return {
    WorkspaceService: tag,
    resolveWorkspaceCwd: vi.fn((cwd?: string) => cwd ?? '/default'),
  };
});

vi.mock('../../src/core/error.js', () => ({
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

// ---- Memory ----
describe('GET /memory/config', () => {
  it('returns memory config with types', async () => {
    const res = await settingsRouter.request('/memory/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; types: any[] };
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
    const body = (await res.json()) as { enabled: boolean };
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
    const body = (await res.json()) as { error: string };
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
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });
});

// ---- Agents ----
describe('GET /agents', () => {
  it('returns global agents with source and disabled fields', async () => {
    const { loadGlobalAgentProfiles } = await import('../../src/subagent/loader.js');
    vi.mocked(loadGlobalAgentProfiles).mockReturnValue([
      { name: 'my-agent', description: 'Test', tools: ['read_file'] },
    ]);
    const res = await settingsRouter.request('/agents?cwd=global');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(3); // EXPLORE + PLAN + my-agent
    // EXPLORE is builtin
    expect(body[0].name).toBe('explore');
    expect(body[0].source).toBe('builtin');
    expect(body[0].disabled).toBe(false);
    // PLAN is builtin
    expect(body[1].name).toBe('plan');
    expect(body[1].source).toBe('builtin');
    expect(body[1].disabled).toBe(false);
    // my-agent is global
    expect(body[2].name).toBe('my-agent');
    expect(body[2].source).toBe('global');
    expect(body[2].disabled).toBe(false);
  });

  it('returns project agents with merged view', async () => {
    const { loadGlobalAgentProfiles, loadAgentProfiles } =
      await import('../../src/subagent/loader.js');
    const { getProjectAgentDisabledState, resolveAgentDisabled } =
      await import('../../src/subagent/registry.js');
    vi.mocked(loadGlobalAgentProfiles).mockReturnValue([
      { name: 'global-agent', description: 'Global', tools: ['read_file'] },
    ]);
    vi.mocked(loadAgentProfiles).mockReturnValue([
      { name: 'project-agent', description: 'Project', tools: ['write_file'] },
    ]);
    vi.mocked(getProjectAgentDisabledState).mockReturnValue(undefined);
    vi.mocked(resolveAgentDisabled).mockReturnValue(false);
    const res = await settingsRouter.request('/agents?cwd=/my-project');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    // EXPLORE + PLAN + global-agent + project-agent
    expect(body).toHaveLength(4);
    expect(body[0].source).toBe('builtin');
    expect(body[1].source).toBe('builtin');
    expect(body[2].source).toBe('global');
    expect(body[3].source).toBe('project');
  });
});

describe('POST /agents/:name/disabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setGlobalAgentDisabledState for global cwd', async () => {
    const { setGlobalAgentDisabledState } = await import('../../src/subagent/registry.js');
    const res = await settingsRouter.request('/agents/my-agent/disabled?cwd=global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(res.status).toBe(200);
    expect(setGlobalAgentDisabledState).toHaveBeenCalledWith('my-agent', true);
  });

  it('calls setProjectAgentDisabledState for project cwd', async () => {
    const { setProjectAgentDisabledState } = await import('../../src/subagent/registry.js');
    const res = await settingsRouter.request('/agents/my-agent/disabled?cwd=/my-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(res.status).toBe(200);
    expect(setProjectAgentDisabledState).toHaveBeenCalledWith('/my-project', 'my-agent', true);
  });
});

describe('POST /agents/:name/disabled/reset', () => {
  it('calls resetProjectAgentDisabledState', async () => {
    const { resetProjectAgentDisabledState } = await import('../../src/subagent/registry.js');
    const res = await settingsRouter.request('/agents/my-agent/disabled/reset?cwd=/my-project', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(resetProjectAgentDisabledState).toHaveBeenCalledWith('/my-project', 'my-agent');
  });
});

// ---- Subagent enabled ----
describe('GET /subagent/enabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns global enabled state with source=global when no cwd', async () => {
    const { getSubagentEnabledState } = await import('../../src/subagent/registry.js');
    vi.mocked(getSubagentEnabledState).mockReturnValue(true);
    const res = await settingsRouter.request('/subagent/enabled');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; source: string };
    expect(body.enabled).toBe(true);
    expect(body.source).toBe('global');
  });

  it('returns project enabled state with source=project when project override exists', async () => {
    const { getProjectSubagentEnabledState, resolveSubagentEnabled } =
      await import('../../src/subagent/registry.js');
    vi.mocked(getProjectSubagentEnabledState).mockReturnValue(false);
    vi.mocked(resolveSubagentEnabled).mockReturnValue(false);
    const res = await settingsRouter.request('/subagent/enabled?cwd=/my-project');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; source: string };
    expect(body.enabled).toBe(false);
    expect(body.source).toBe('project');
  });

  it('returns source=global when no project override', async () => {
    const { getProjectSubagentEnabledState, resolveSubagentEnabled } =
      await import('../../src/subagent/registry.js');
    vi.mocked(getProjectSubagentEnabledState).mockReturnValue(undefined);
    vi.mocked(resolveSubagentEnabled).mockReturnValue(true);
    const res = await settingsRouter.request('/subagent/enabled?cwd=/my-project');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; source: string };
    expect(body.source).toBe('global');
  });
});

describe('POST /subagent/enabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setSubagentEnabledState for global cwd', async () => {
    const { setSubagentEnabledState } = await import('../../src/subagent/registry.js');
    const res = await settingsRouter.request('/subagent/enabled?cwd=global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(setSubagentEnabledState).toHaveBeenCalledWith(false);
  });

  it('calls setProjectSubagentEnabledState for project cwd', async () => {
    const { setProjectSubagentEnabledState } = await import('../../src/subagent/registry.js');
    const res = await settingsRouter.request('/subagent/enabled?cwd=/my-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(setProjectSubagentEnabledState).toHaveBeenCalledWith('/my-project', false);
  });
});

describe('POST /subagent/enabled/reset', () => {
  it('calls resetProjectSubagentEnabledState', async () => {
    const { resetProjectSubagentEnabledState } = await import('../../src/subagent/registry.js');
    const res = await settingsRouter.request('/subagent/enabled/reset?cwd=/my-project', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(resetProjectSubagentEnabledState).toHaveBeenCalledWith('/my-project');
  });
});

// ---- MCP ----
describe('GET /mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns global MCP servers with source and disabled', async () => {
    const { loadGlobalMcpConfig, getGlobalMcpDisabledState } =
      await import('../../src/mcp/config.js');
    vi.mocked(loadGlobalMcpConfig).mockReturnValue([{ name: 'server1', command: 'npx' }]);
    vi.mocked(getGlobalMcpDisabledState).mockReturnValue(false);
    const res = await settingsRouter.request('/mcp?cwd=global');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(1);
    expect(body[0].source).toBe('global');
    expect(body[0].disabled).toBe(false);
  });

  it('returns project MCP servers with merged view', async () => {
    const { loadGlobalMcpConfig, loadMcpConfig, resolveMcpConfig, resolveMcpDisabled } =
      await import('../../src/mcp/config.js');
    vi.mocked(loadGlobalMcpConfig).mockReturnValue([{ name: 'global-srv', command: 'npx' }]);
    vi.mocked(loadMcpConfig).mockReturnValue([{ name: 'project-srv', command: 'node' }]);
    vi.mocked(resolveMcpConfig).mockReturnValue([
      { name: 'global-srv', command: 'npx' },
      { name: 'project-srv', command: 'node' },
    ]);
    vi.mocked(resolveMcpDisabled).mockReturnValue(false);
    const res = await settingsRouter.request('/mcp?cwd=/my-project');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(2);
    expect(body[0].source).toBe('global');
    expect(body[1].source).toBe('project');
  });
});

describe('POST /mcp/:name/disabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setGlobalMcpDisabledState for global cwd', async () => {
    const { setGlobalMcpDisabledState } = await import('../../src/mcp/config.js');
    const res = await settingsRouter.request('/mcp/srv1/disabled?cwd=global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(res.status).toBe(200);
    expect(setGlobalMcpDisabledState).toHaveBeenCalledWith('srv1', true);
  });

  it('calls setProjectMcpDisabledState for project cwd', async () => {
    const { setProjectMcpDisabledState } = await import('../../src/mcp/config.js');
    const res = await settingsRouter.request('/mcp/srv1/disabled?cwd=/my-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(res.status).toBe(200);
    expect(setProjectMcpDisabledState).toHaveBeenCalledWith('/my-project', 'srv1', true);
  });
});

describe('POST /mcp/:name/disabled/reset', () => {
  it('calls resetProjectMcpDisabledState', async () => {
    const { resetProjectMcpDisabledState } = await import('../../src/mcp/config.js');
    const res = await settingsRouter.request('/mcp/srv1/disabled/reset?cwd=/my-project', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(resetProjectMcpDisabledState).toHaveBeenCalledWith('/my-project', 'srv1');
  });
});

// ---- Hooks ----
describe('GET /hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns global hooks with source field', async () => {
    const { loadGlobalHookConfigs } = await import('../../src/hooks/config.js');
    vi.mocked(loadGlobalHookConfigs).mockReturnValue([
      {
        name: 'hook1',
        point: 'tool.execute.before',
        type: 'observer',
        command: 'echo',
        enabled: true,
      },
    ]);
    const res = await settingsRouter.request('/hooks?cwd=global');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(1);
    expect(body[0].source).toBe('global');
  });

  it('returns project hooks with merged view', async () => {
    const { loadGlobalHookConfigs, loadHookConfigs, resolveHookConfigs, resolveHookDisabled } =
      await import('../../src/hooks/config.js');
    vi.mocked(loadGlobalHookConfigs).mockReturnValue([
      {
        name: 'global-hook',
        point: 'tool.execute.before',
        type: 'observer',
        command: 'echo',
        enabled: true,
      },
    ]);
    vi.mocked(loadHookConfigs).mockReturnValue([
      {
        name: 'project-hook',
        point: 'tool.execute.after',
        type: 'decision',
        command: 'sh',
        enabled: true,
      },
    ]);
    vi.mocked(resolveHookConfigs).mockReturnValue([
      {
        name: 'global-hook',
        point: 'tool.execute.before',
        type: 'observer',
        command: 'echo',
        enabled: true,
      },
      {
        name: 'project-hook',
        point: 'tool.execute.after',
        type: 'decision',
        command: 'sh',
        enabled: true,
      },
    ]);
    vi.mocked(resolveHookDisabled).mockReturnValue(false);
    const res = await settingsRouter.request('/hooks?cwd=/my-project');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(2);
    expect(body[0].source).toBe('global');
    expect(body[1].source).toBe('project');
  });
});

describe('POST /hooks/:name/disabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setGlobalHookDisabledState for global cwd', async () => {
    const { setGlobalHookDisabledState } = await import('../../src/hooks/config.js');
    const res = await settingsRouter.request('/hooks/hook1/disabled?cwd=global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(res.status).toBe(200);
    expect(setGlobalHookDisabledState).toHaveBeenCalledWith('hook1', true);
  });

  it('calls setProjectHookDisabledState for project cwd', async () => {
    const { setProjectHookDisabledState } = await import('../../src/hooks/config.js');
    const res = await settingsRouter.request('/hooks/hook1/disabled?cwd=/my-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(res.status).toBe(200);
    expect(setProjectHookDisabledState).toHaveBeenCalledWith('/my-project', 'hook1', true);
  });
});

describe('POST /hooks/:name/disabled/reset', () => {
  it('calls resetProjectHookDisabledState', async () => {
    const { resetProjectHookDisabledState } = await import('../../src/hooks/config.js');
    const res = await settingsRouter.request('/hooks/hook1/disabled/reset?cwd=/my-project', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(resetProjectHookDisabledState).toHaveBeenCalledWith('/my-project', 'hook1');
  });
});

// ---- Skills ----
describe('POST /skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setGlobalSkillDisabledState for global cwd', async () => {
    const { setGlobalSkillDisabledState } = await import('../../src/skills/config.js');
    const res = await settingsRouter.request('/skills?cwd=global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'my-skill', enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(setGlobalSkillDisabledState).toHaveBeenCalledWith('my-skill', true);
  });

  it('calls setProjectSkillDisabledState for project cwd', async () => {
    const { setProjectSkillDisabledState } = await import('../../src/skills/config.js');
    const res = await settingsRouter.request('/skills?cwd=/my-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'my-skill', enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(setProjectSkillDisabledState).toHaveBeenCalledWith('/my-project', 'my-skill', true);
  });
});

// ---- Memory config extended ----
describe('GET /memory/config (extended)', () => {
  it('returns model field', async () => {
    const res = await settingsRouter.request('/memory/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('model');
  });
});

// ---- Memory model ----
describe('POST /memory/model', () => {
  it('updates memory model via updateMemoryModel', async () => {
    const { updateMemoryModel } = await import('@codingcode/infra/config');
    const res = await settingsRouter.request('/memory/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-v4-flash' }),
    });
    expect(res.status).toBe(200);
    expect(updateMemoryModel).toHaveBeenCalledWith('deepseek-v4-flash');
  });
});

// ---- Agent config ----
describe('GET /agent/config', () => {
  it('returns maxSteps and maxStopContinuations from loadConfig', async () => {
    const res = await settingsRouter.request('/agent/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('maxSteps');
    expect(body).toHaveProperty('maxStopContinuations');
  });
});

describe('POST /agent/config', () => {
  it('updates maxSteps via updateMaxSteps', async () => {
    const { updateMaxSteps } = await import('@codingcode/infra/config');
    const res = await settingsRouter.request('/agent/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxSteps: 500 }),
    });
    expect(res.status).toBe(200);
    expect(updateMaxSteps).toHaveBeenCalledWith(500);
  });

  it('updates maxStopContinuations via updateMaxStopContinuations', async () => {
    const { updateMaxStopContinuations } = await import('@codingcode/infra/config');
    const res = await settingsRouter.request('/agent/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxStopContinuations: 10 }),
    });
    expect(res.status).toBe(200);
    expect(updateMaxStopContinuations).toHaveBeenCalledWith(10);
  });
});

// ---- Context compaction model ----
describe('POST /context/compaction-model', () => {
  it('updates compaction model via updateContextCompactionModel', async () => {
    const { updateContextCompactionModel } = await import('@codingcode/infra/config');
    const res = await settingsRouter.request('/context/compaction-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compactionModel: 'gpt-4o-mini' }),
    });
    expect(res.status).toBe(200);
    expect(updateContextCompactionModel).toHaveBeenCalledWith('gpt-4o-mini');
  });
});
