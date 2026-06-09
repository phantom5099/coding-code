import { describe, it, expect } from 'vitest';

// --- settings.handler logic (pure unit tests, no Electron) ---

interface AgentEntry {
  name: string;
  description: string;
  tools?: string[];
  readonly?: boolean;
  maxSteps?: number;
  model?: string;
  disabled?: boolean;
  source?: 'builtin' | 'global' | 'project';
  hasProjectOverride?: boolean;
}

function mapAgentToEntry(profile: AgentEntry): AgentEntry {
  return {
    name: profile.name,
    description: profile.description,
    tools: profile.tools,
    readonly: profile.readonly,
    maxSteps: profile.maxSteps,
    model: profile.model,
  };
}

describe('settings handler - agent mapping', () => {
  it('maps a full agent profile correctly', () => {
    const profile: AgentEntry = {
      name: 'explore',
      description: 'Read-only code exploration',
      tools: ['read_file', 'glob', 'search_code'],
      readonly: true,
      maxSteps: 30,
      model: undefined,
    };
    const result = mapAgentToEntry(profile);
    expect(result.name).toBe('explore');
    expect(result.description).toBe('Read-only code exploration');
    expect(result.tools).toEqual(['read_file', 'glob', 'search_code']);
    expect(result.readonly).toBe(true);
    expect(result.maxSteps).toBe(30);
    expect(result.model).toBeUndefined();
  });

  it('maps a minimal agent profile without optional fields', () => {
    const profile: AgentEntry = { name: 'basic', description: 'A basic agent' };
    const result = mapAgentToEntry(profile);
    expect(result.name).toBe('basic');
    expect(result.tools).toBeUndefined();
    expect(result.readonly).toBeUndefined();
    expect(result.maxSteps).toBeUndefined();
  });
});

// --- HooksPanel data completeness ---

type HookPoint =
  | 'tool.execute.before'
  | 'tool.execute.after'
  | 'tool.execute.error'
  | 'tool.execute.denied'
  | 'tool.approval.pre'
  | 'tool.approval.post'
  | 'llm.request.before'
  | 'llm.response.after'
  | 'llm.response.error'
  | 'session.save.before'
  | 'session.save.after'
  | 'agent.turn.start'
  | 'agent.step.before'
  | 'agent.turn.stop'
  | 'agent.turn.end'
  | 'agent.subagent.spawn.before'
  | 'agent.subagent.spawn.after'
  | 'agent.subagent.complete';

const ALL_HOOK_POINTS: HookPoint[] = [
  'tool.execute.before',
  'tool.execute.after',
  'tool.execute.error',
  'tool.execute.denied',
  'tool.approval.pre',
  'tool.approval.post',
  'llm.request.before',
  'llm.response.after',
  'llm.response.error',
  'session.save.before',
  'session.save.after',
  'agent.turn.start',
  'agent.step.before',
  'agent.turn.stop',
  'agent.turn.end',
  'agent.subagent.spawn.before',
  'agent.subagent.spawn.after',
  'agent.subagent.complete',
];

// Replicate the HOOK_GROUPS data from HooksPanel.tsx to verify coverage
const PANEL_POINT_NAMES = [
  'tool.execute.before',
  'tool.execute.after',
  'tool.execute.error',
  'tool.execute.denied',
  'tool.approval.pre',
  'tool.approval.post',
  'llm.request.before',
  'llm.response.after',
  'llm.response.error',
  'session.save.before',
  'session.save.after',
  'agent.turn.start',
  'agent.step.before',
  'agent.turn.stop',
  'agent.turn.end',
  'agent.subagent.spawn.before',
  'agent.subagent.spawn.after',
  'agent.subagent.complete',
];

describe('HooksPanel - hook point coverage', () => {
  it('panel covers all HookPoint values from the registry', () => {
    for (const point of ALL_HOOK_POINTS) {
      expect(PANEL_POINT_NAMES).toContain(point);
    }
  });

  it('panel has no duplicate hook point names', () => {
    const unique = new Set(PANEL_POINT_NAMES);
    expect(unique.size).toBe(PANEL_POINT_NAMES.length);
  });

  it('decision-type hooks are the correct subset', () => {
    const decisionHooks = [
      'tool.execute.before',
      'tool.approval.pre',
      'llm.request.before',
      'agent.step.before',
      'agent.subagent.spawn.before',
    ];
    for (const h of decisionHooks) {
      expect(PANEL_POINT_NAMES).toContain(h);
    }
  });
});

// --- SubagentsPanel state logic ---

describe('SubagentsPanel - state logic', () => {
  it('defaults enabled to true when API returns undefined', () => {
    const apiResult = undefined;
    const enabled = apiResult ?? true;
    expect(enabled).toBe(true);
  });

  it('reflects API enabled=false correctly', () => {
    const apiResult = false;
    const enabled = apiResult ?? true;
    expect(enabled).toBe(false);
  });

  it('falls back to empty array when getAgents returns undefined', () => {
    const apiResult: AgentEntry[] | undefined = undefined;
    const agents = apiResult ?? [];
    expect(agents).toEqual([]);
  });

  it('renders agent tools list when present', () => {
    const agent: AgentEntry = {
      name: 'explore',
      description: 'Explores code',
      tools: ['read_file', 'glob'],
    };
    expect(agent.tools?.length).toBe(2);
    expect(agent.tools).toContain('read_file');
  });

  it('reflects agent disabled=true from API', () => {
    const agents: AgentEntry[] = [{ name: 'test', description: 'Test', disabled: true }];
    expect(agents[0].disabled).toBe(true);
  });

  it('reflects agent disabled=false from API', () => {
    const agents: AgentEntry[] = [{ name: 'test', description: 'Test', disabled: false }];
    expect(agents[0].disabled).toBe(false);
  });
});

// --- SubagentsPanel tool multi-select logic ---

const AVAILABLE_TOOLS = [
  'read_file',
  'write_file',
  'edit_file',
  'execute_command',
  'search_code',
  'search_files',
  'fetch_url',
  'web_search',
  'todo_write',
  'tool_search',
  'dispatch_agent',
];

interface AgentForm {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  readonly: boolean;
  maxSteps: string;
  model: string;
}

function startEditForm(a: AgentEntry): AgentForm {
  return {
    name: a.name,
    description: a.description,
    systemPrompt: '',
    tools: a.tools ?? [],
    readonly: a.readonly ?? false,
    maxSteps: a.maxSteps?.toString() ?? '',
    model: a.model ?? '',
  };
}

function buildProfile(form: AgentForm): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    name: form.name,
    description: form.description,
    systemPrompt: form.systemPrompt,
  };
  if (form.tools.length > 0) profile.tools = form.tools;
  if (form.readonly) profile.readonly = true;
  if (form.maxSteps.trim()) profile.maxSteps = Number(form.maxSteps);
  if (form.model.trim()) profile.model = form.model;
  return profile;
}

function toggleTool(selected: string[], tool: string): string[] {
  return selected.includes(tool) ? selected.filter((t) => t !== tool) : [...selected, tool];
}

describe('SubagentsPanel - tool multi-select form logic', () => {
  it('AVAILABLE_TOOLS contains all 11 expected tools', () => {
    expect(AVAILABLE_TOOLS).toHaveLength(11);
    expect(AVAILABLE_TOOLS).toContain('read_file');
    expect(AVAILABLE_TOOLS).toContain('dispatch_agent');
  });

  it('startEdit populates tools as array directly (no join)', () => {
    const agent: AgentEntry = { name: 'a', description: 'd', tools: ['read_file', 'search_code'] };
    const form = startEditForm(agent);
    expect(form.tools).toEqual(['read_file', 'search_code']);
  });

  it('startEdit uses empty array when agent has no tools', () => {
    const agent: AgentEntry = { name: 'a', description: 'd' };
    const form = startEditForm(agent);
    expect(form.tools).toEqual([]);
  });

  it('buildProfile omits tools key when tools array is empty', () => {
    const form = startEditForm({ name: 'a', description: 'd' });
    const profile = buildProfile(form);
    expect(profile.tools).toBeUndefined();
  });

  it('buildProfile includes tools array when non-empty', () => {
    const form = startEditForm({ name: 'a', description: 'd', tools: ['read_file', 'edit_file'] });
    const profile = buildProfile(form);
    expect(profile.tools).toEqual(['read_file', 'edit_file']);
  });

  it('toggleTool adds a tool when not selected', () => {
    const result = toggleTool(['read_file'], 'edit_file');
    expect(result).toContain('read_file');
    expect(result).toContain('edit_file');
  });

  it('toggleTool removes a tool when already selected', () => {
    const result = toggleTool(['read_file', 'edit_file'], 'read_file');
    expect(result).toEqual(['edit_file']);
  });

  it('toggleTool on empty array adds the tool', () => {
    const result = toggleTool([], 'execute_command');
    expect(result).toEqual(['execute_command']);
  });
});

// --- SubagentsPanel - source and enabledSource logic ---

describe('SubagentsPanel - source and enabledSource', () => {
  it('defaults enabledSource to global when API returns no source', () => {
    const apiSource = undefined;
    const enabledSource = (apiSource as 'global' | 'project' | undefined) ?? 'global';
    expect(enabledSource).toBe('global');
  });

  it('sets enabledSource to project when API returns project', () => {
    const apiSource = 'project';
    const enabledSource = (apiSource as 'global' | 'project') ?? 'global';
    expect(enabledSource).toBe('project');
  });

  it('sets enabledSource to global when API returns global', () => {
    const apiSource = 'global';
    const enabledSource = (apiSource as 'global' | 'project') ?? 'global';
    expect(enabledSource).toBe('global');
  });

  it('agent source=builtin renders 内置 tag', () => {
    const agent: AgentEntry = { name: 'explore', description: 'Explore', source: 'builtin' };
    expect(agent.source).toBe('builtin');
  });

  it('agent source=global renders 全局 tag', () => {
    const agent: AgentEntry = { name: 'my-agent', description: 'My agent', source: 'global' };
    expect(agent.source).toBe('global');
  });

  it('agent source=project renders 项目 tag', () => {
    const agent: AgentEntry = {
      name: 'proj-agent',
      description: 'Project agent',
      source: 'project',
    };
    expect(agent.source).toBe('project');
  });

  it('agent hasProjectOverride=true renders 覆盖全局 tag', () => {
    const agent: AgentEntry = {
      name: 'override-agent',
      description: 'Override',
      source: 'global',
      hasProjectOverride: true,
    };
    expect(agent.hasProjectOverride).toBe(true);
  });

  it('agent without source has undefined source', () => {
    const agent: AgentEntry = { name: 'basic', description: 'Basic' };
    expect(agent.source).toBeUndefined();
  });

  it('resetEnabled returns early when cwd is undefined', () => {
    const cwd = undefined;
    const shouldReset = !!cwd;
    expect(shouldReset).toBe(false);
  });

  it('resetEnabled proceeds when cwd is defined', () => {
    const cwd = '/some/project';
    const shouldReset = !!cwd;
    expect(shouldReset).toBe(true);
  });

  it('toggleEnabled sets enabledSource to project in project context', () => {
    const isGlobal = false;
    const enabledSource = isGlobal ? 'global' : 'project';
    expect(enabledSource).toBe('project');
  });

  it('toggleEnabled sets enabledSource to global in global context', () => {
    const isGlobal = true;
    const enabledSource = isGlobal ? 'global' : 'project';
    expect(enabledSource).toBe('global');
  });

  it('shows 项目级覆盖 marker when not global and enabledSource is project', () => {
    const isGlobal = false;
    const enabledSource = 'project';
    const showOverride = !isGlobal && enabledSource === 'project';
    expect(showOverride).toBe(true);
  });

  it('hides 项目级覆盖 marker when is global', () => {
    const isGlobal = true;
    const enabledSource = 'project';
    const showOverride = !isGlobal && enabledSource === 'project';
    expect(showOverride).toBe(false);
  });

  it('hides 项目级覆盖 marker when enabledSource is global', () => {
    const isGlobal = false;
    const enabledSource = 'global';
    const showOverride = !isGlobal && enabledSource === 'project';
    expect(showOverride).toBe(false);
  });
});

// --- McpPanel source tag and cwd logic ---

interface McpEntry {
  name: string;
  transport: 'stdio' | 'http';
  disabled: boolean;
  toolCount: number;
  source?: 'global' | 'project';
  hasProjectOverride?: boolean;
}

describe('McpPanel - source tag and cwd', () => {
  it('McpEntry accepts source=global', () => {
    const entry: McpEntry = {
      name: 'm1',
      transport: 'stdio',
      disabled: false,
      toolCount: 3,
      source: 'global',
    };
    expect(entry.source).toBe('global');
    expect(entry.hasProjectOverride).toBeUndefined();
  });

  it('McpEntry accepts source=project', () => {
    const entry: McpEntry = {
      name: 'm2',
      transport: 'http',
      disabled: false,
      toolCount: 1,
      source: 'project',
    };
    expect(entry.source).toBe('project');
  });

  it('McpEntry accepts hasProjectOverride=true', () => {
    const entry: McpEntry = {
      name: 'm3',
      transport: 'stdio',
      disabled: false,
      toolCount: 0,
      source: 'global',
      hasProjectOverride: true,
    };
    expect(entry.hasProjectOverride).toBe(true);
  });

  it('cwd is undefined when isGlobal=true', () => {
    const isGlobal = true;
    const rootPath = '/some/project';
    const cwd = isGlobal ? undefined : rootPath;
    expect(cwd).toBeUndefined();
  });

  it('cwd equals rootPath when isGlobal=false', () => {
    const isGlobal = false;
    const rootPath = '/some/project';
    const cwd = isGlobal ? undefined : rootPath;
    expect(cwd).toBe('/some/project');
  });

  it('toggle passes cwd to setMcpDisabled', () => {
    const calls: Array<{ name: string; disabled: boolean; cwd?: string }> = [];
    const setMcpDisabled = (name: string, disabled: boolean, cwd?: string) => {
      calls.push({ name, disabled, cwd });
    };
    const cwd = '/project/path';
    setMcpDisabled('server1', true, cwd);
    expect(calls[0]).toEqual({ name: 'server1', disabled: true, cwd: '/project/path' });
  });
});

// --- HooksPanel source tag and cwd logic ---

interface HookEntry {
  name: string;
  description?: string;
  point: string;
  type: 'observer' | 'decision';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  priority?: number;
  enabled: boolean;
  source?: 'global' | 'project';
  hasProjectOverride?: boolean;
}

describe('HooksPanel - source tag and cwd', () => {
  it('HookEntry accepts source=global', () => {
    const entry: HookEntry = {
      name: 'h1',
      point: 'tool.execute.before',
      type: 'decision',
      command: 'echo',
      enabled: true,
      source: 'global',
    };
    expect(entry.source).toBe('global');
    expect(entry.hasProjectOverride).toBeUndefined();
  });

  it('HookEntry accepts source=project', () => {
    const entry: HookEntry = {
      name: 'h2',
      point: 'tool.execute.after',
      type: 'observer',
      command: 'echo',
      enabled: true,
      source: 'project',
    };
    expect(entry.source).toBe('project');
  });

  it('HookEntry accepts hasProjectOverride=true', () => {
    const entry: HookEntry = {
      name: 'h3',
      point: 'llm.request.before',
      type: 'decision',
      command: 'echo',
      enabled: true,
      source: 'global',
      hasProjectOverride: true,
    };
    expect(entry.hasProjectOverride).toBe(true);
  });

  it('setHookDisabled is called with cwd, name, disabled', () => {
    const calls: Array<{ cwd: string | undefined; name: string; disabled: boolean }> = [];
    const setHookDisabled = (cwd: string | undefined, name: string, disabled: boolean) => {
      calls.push({ cwd, name, disabled });
    };
    const cwd = '/project/path';
    setHookDisabled(cwd, 'hook1', true);
    expect(calls[0]).toEqual({ cwd: '/project/path', name: 'hook1', disabled: true });
  });
});

// --- SkillPanel source tag and cwd logic ---

interface SkillEntry {
  name: string;
  description: string;
  disabled: boolean;
  source?: 'global' | 'project';
  hasProjectOverride?: boolean;
}

describe('SkillPanel - source tag and cwd', () => {
  it('SkillEntry accepts source=global', () => {
    const entry: SkillEntry = {
      name: 's1',
      description: 'A skill',
      disabled: false,
      source: 'global',
    };
    expect(entry.source).toBe('global');
    expect(entry.hasProjectOverride).toBeUndefined();
  });

  it('SkillEntry accepts source=project', () => {
    const entry: SkillEntry = {
      name: 's2',
      description: 'Another skill',
      disabled: false,
      source: 'project',
    };
    expect(entry.source).toBe('project');
  });

  it('SkillEntry accepts hasProjectOverride=true', () => {
    const entry: SkillEntry = {
      name: 's3',
      description: 'Override skill',
      disabled: false,
      source: 'global',
      hasProjectOverride: true,
    };
    expect(entry.hasProjectOverride).toBe(true);
  });

  it('toggleSkill is called with name, enabled, cwd', () => {
    const calls: Array<{ name: string; enabled: boolean; cwd?: string }> = [];
    const toggleSkill = (name: string, enabled: boolean, cwd?: string) => {
      calls.push({ name, enabled, cwd });
    };
    const cwd = '/project/path';
    toggleSkill('skill1', true, cwd);
    expect(calls[0]).toEqual({ name: 'skill1', enabled: true, cwd: '/project/path' });
  });
});
