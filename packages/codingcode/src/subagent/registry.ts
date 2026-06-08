import { Effect } from 'effect';
import type { UserHookConfig } from '../hooks/config.js';
import { loadConfig, getUserConfigPath } from '@codingcode/infra';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { dirname, join } from 'path';

export interface AgentProfile {
  name: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
  mcpServers?: string[];
  readonly?: boolean;
  maxSteps?: number;
  model?: string;
  hooks?: UserHookConfig[];
  disabled?: boolean;
}

// ---- 全局级子智能体开关 ----

export function getSubagentEnabledState(): boolean {
  try {
    const config = loadConfig() as any;
    return config.subagent?.enabled ?? true;
  } catch {
    return true;
  }
}

export function setSubagentEnabledState(v: boolean): void {
  const p = getUserConfigPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const subagent = (existing.subagent as Record<string, unknown>) ?? {};
  existing.subagent = { ...subagent, enabled: v };
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

// ---- 项目级子智能体开关：持久化到 .codingcode/config.yaml ----

export function getProjectSubagentEnabledState(projectCwd: string): boolean | undefined {
  const p = join(projectCwd, '.codingcode', 'config.yaml');
  if (!existsSync(p)) return undefined;
  try {
    const raw = readFileSync(p, 'utf8');
    const config = parseYaml(raw) as any;
    return config.subagent?.enabled;
  } catch {
    return undefined;
  }
}

export function setProjectSubagentEnabledState(projectCwd: string, v: boolean): void {
  const dir = join(projectCwd, '.codingcode');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'config.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const subagent = (existing.subagent as Record<string, unknown>) ?? {};
  existing.subagent = { ...subagent, enabled: v };
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function resetProjectSubagentEnabledState(projectCwd: string): void {
  const p = join(projectCwd, '.codingcode', 'config.yaml');
  if (!existsSync(p)) return;
  const existing: Record<string, unknown> = parseYaml(readFileSync(p, 'utf8')) as Record<
    string,
    unknown
  >;
  const subagent = (existing.subagent as Record<string, unknown>) ?? {};
  delete subagent.enabled;
  if (Object.keys(subagent).length === 0) {
    delete existing.subagent;
  } else {
    existing.subagent = subagent;
  }
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

// 解析最终生效的子智能体开关：项目级 > 全局级
export function resolveSubagentEnabled(projectCwd: string): boolean {
  const projectVal = getProjectSubagentEnabledState(projectCwd);
  if (projectVal !== undefined) return projectVal;
  return getSubagentEnabledState();
}

// ---- 全局级 agent disabled 状态：持久化到 ~/.codingcode/config.yaml ----

export function getGlobalAgentDisabledState(agentName: string): boolean {
  try {
    const config = loadConfig() as any;
    const disabled = config.subagent?.disabledAgents as Record<string, boolean>;
    return disabled?.[agentName] ?? false;
  } catch {
    return false;
  }
}

export function setGlobalAgentDisabledState(agentName: string, disabled: boolean): void {
  const p = getUserConfigPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const subagent = (existing.subagent as Record<string, unknown>) ?? {};
  const disabledAgents = (subagent.disabledAgents as Record<string, boolean>) ?? {};
  disabledAgents[agentName] = disabled;
  subagent.disabledAgents = disabledAgents;
  existing.subagent = subagent;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

// ---- 项目级 agent disabled 状态：持久化到 .codingcode/config.yaml ----

export function getProjectAgentDisabledState(
  projectCwd: string,
  agentName: string
): boolean | undefined {
  const p = join(projectCwd, '.codingcode', 'config.yaml');
  if (!existsSync(p)) return undefined;
  try {
    const raw = readFileSync(p, 'utf8');
    const config = parseYaml(raw) as any;
    const disabled = config.subagent?.disabledAgents as Record<string, boolean>;
    return disabled?.[agentName];
  } catch {
    return undefined;
  }
}

export function setProjectAgentDisabledState(
  projectCwd: string,
  agentName: string,
  disabled: boolean
): void {
  const dir = join(projectCwd, '.codingcode');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'config.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const subagent = (existing.subagent as Record<string, unknown>) ?? {};
  const disabledAgents = (subagent.disabledAgents as Record<string, boolean>) ?? {};
  disabledAgents[agentName] = disabled;
  subagent.disabledAgents = disabledAgents;
  existing.subagent = subagent;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function resetProjectAgentDisabledState(projectCwd: string, agentName: string): void {
  const p = join(projectCwd, '.codingcode', 'config.yaml');
  if (!existsSync(p)) return;
  const existing: Record<string, unknown> = parseYaml(readFileSync(p, 'utf8')) as Record<
    string,
    unknown
  >;
  const subagent = (existing.subagent as Record<string, unknown>) ?? {};
  const disabledAgents = subagent.disabledAgents as Record<string, boolean>;
  if (disabledAgents) {
    delete disabledAgents[agentName];
    subagent.disabledAgents = disabledAgents;
  }
  existing.subagent = subagent;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

// 解析最终生效的 agent disabled 状态：项目级 > 全局级
export function resolveAgentDisabled(projectCwd: string, agentName: string): boolean {
  const projectVal = getProjectAgentDisabledState(projectCwd, agentName);
  if (projectVal !== undefined) return projectVal;
  return getGlobalAgentDisabledState(agentName);
}

export class SubagentRegistry extends Effect.Service<SubagentRegistry>()('SubagentRegistry', {
  effect: Effect.gen(function* () {
    const map = new Map<string, AgentProfile>();

    return {
      register: (profile: AgentProfile): void => {
        map.set(profile.name, profile);
      },

      get: (name: string): AgentProfile | undefined => {
        return map.get(name);
      },

      list: (): AgentProfile[] => {
        return Array.from(map.values());
      },

      reset: (): void => {
        map.clear();
      },
    };
  }),
}) {}

export const EXPLORE_PROFILE: AgentProfile = {
  name: 'explore',
  description:
    'Read-only code exploration: searching files, reading symbols, understanding structure. No writes.',
  systemPrompt:
    'You are a read-only code exploration agent. Your role is to help explore and understand codebases through reading files, searching for symbols, and analyzing code structure. You can only read; you cannot write or modify files.',
  tools: ['read_file', 'search_files', 'search_code', 'fetch_url', 'tool_search'],
  readonly: true,
  maxSteps: 30,
};
