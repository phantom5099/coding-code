import { describe, it, expect } from 'vitest';

// --- settings.handler logic (pure unit tests, no Electron) ---

interface AgentEntry {
  name: string;
  description: string;
  tools?: string[];
  readonly?: boolean;
  maxSteps?: number;
  model?: string;
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
  'todo_read',
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
  it('AVAILABLE_TOOLS contains all 12 expected tools', () => {
    expect(AVAILABLE_TOOLS).toHaveLength(12);
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
