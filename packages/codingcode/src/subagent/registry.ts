import type { AgentProfile } from './types.js';
import { loadConfig, getUserConfigPath } from '@codingcode/infra/config';
import { createDisabledStore } from '@codingcode/infra/disabled-store';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { dirname, join } from 'path';
import { Effect } from 'effect';

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

// ---- Agent disabled 状态：复用 createDisabledStore ----

const agentDisabledStore = createDisabledStore({
  globalKeyPath: ['subagent', 'disabledAgents'],
});

export const getGlobalAgentDisabledState = agentDisabledStore.getGlobal;
export const setGlobalAgentDisabledState = agentDisabledStore.setGlobal;
export const getProjectAgentDisabledState = agentDisabledStore.getProject;
export const setProjectAgentDisabledState = agentDisabledStore.setProject;
export const resetProjectAgentDisabledState = agentDisabledStore.resetProject;
export const resolveAgentDisabled = agentDisabledStore.resolve;

// ---- SubagentService: Effect.Service with global + project-level registries ----

export class SubagentService extends Effect.Service<SubagentService>()('Subagent', {
  sync: () => {
    // 全局层：内置 profile + 全局 ~/.codingcode/agents/ profile
    const globalRegistry = new Map<string, AgentProfile>();
    // 项目层：按 projectPath 隔离，项目 profile 覆盖同名全局 profile
    const projectRegistries = new Map<string, Map<string, AgentProfile>>();

    return {
      /** 注册全局 profile（内置 + ~/.codingcode/agents/），只在启动时调用一次 */
      registerGlobal(profiles: AgentProfile[]): void {
        for (const p of profiles) globalRegistry.set(p.name, p);
      },

      /** 注册项目级 profile，覆盖同名全局 profile */
      registerProject(projectPath: string, profiles: AgentProfile[]): void {
        let projectMap = projectRegistries.get(projectPath);
        if (!projectMap) {
          projectMap = new Map();
          projectRegistries.set(projectPath, projectMap);
        }
        for (const p of profiles) projectMap.set(p.name, p);
      },

      /** 查找 profile：项目级优先，回退到全局级 */
      get(projectPath: string, name: string): AgentProfile | undefined {
        const projectMap = projectRegistries.get(projectPath);
        if (projectMap) {
          const fromProject = projectMap.get(name);
          if (fromProject) return fromProject;
        }
        return globalRegistry.get(name);
      },

      /** 列出某项目的全部 profile：项目级覆盖同名全局级 */
      list(projectPath: string): AgentProfile[] {
        const result = new Map<string, AgentProfile>(globalRegistry);
        const projectMap = projectRegistries.get(projectPath);
        if (projectMap) {
          for (const [name, profile] of projectMap) {
            result.set(name, profile);
          }
        }
        return Array.from(result.values());
      },

      /** 清除某项目的注册，不影响其他项目 */
      resetProject(projectPath: string): void {
        projectRegistries.delete(projectPath);
      },
    };
  },
}) {}

export const EXPLORE_PROFILE: AgentProfile = {
  name: 'explore',
  description:
    'Read-only code exploration: searching files, reading symbols, understanding structure. No writes.',
  permissionMode: 'bypass',
  systemPrompt: `You are a read-only code exploration agent. Your role is to help explore and understand codebases through reading files, searching for symbols, and analyzing code structure. You can only read; you cannot write or modify files.

## Guidelines
- Start broad, then narrow down. Use search_files and search_code to get an overview before reading specific files.
- Call multiple tools in parallel when they are independent — for example, searching with different patterns at once, or reading several files simultaneously.
- When referencing code, use the format \`file_path:line_number\`.
- Be thorough but concise in your findings. Focus on what the user asked for — structure your answer around the question, not around the files you read.
- If you cannot find the answer, say so clearly rather than guessing.`,
  tools: ['read_file', 'search_files', 'search_code', 'fetch_url', 'tool_search'],
  readonly: true,
  maxSteps: 180,
};

export const PLAN_PROFILE: AgentProfile = {
  name: 'plan',
  description:
    'Planning agent: analyzes the codebase, produces an implementation plan, and submits it via submit_plan for user approval. No business code modifications.',
  // No `permissionMode` — plan mode is enforced structurally by the
  // `plan/planModeGateHook` (registered on `tool.approval.pre`) and
  // detected via `isPlanProfile(profile)`. The approval pipeline itself
  // does not need to know about this profile.
  systemPrompt: `You are a planning agent. Your role is to analyze the codebase and produce an implementation plan that the user reviews and approves before any code is written.

You can read files, search code, and dispatch the 'explore' subagent for context-heavy investigation. You can submit a plan via the \`submit_plan\` tool — each call overwrites the previous plan file; use it to revise your plan based on user feedback.

In plan mode, write_file / edit_file / execute_command are denied. The only write operation allowed is \`submit_plan\`.

## Subagent dispatch
Use \`dispatch_agent({ agent: 'explore', prompt: '...' })\` to investigate large code sections without polluting your main context. The system hook enforces this — only 'explore' is permitted in plan mode; any other agent name will be denied.

## Research process
1. Understand the project structure and conventions
2. Identify relevant files and existing patterns
3. Analyze dependencies and potential impacts
4. Assess complexity and risks
5. Check for existing implementations or similar patterns

## Output format
When ready, call \`submit_plan({ plan_content: "..." })\` with a Markdown plan:
- **Current state**: What exists today
- **Key files**: Files that need modification or creation, with line references
- **Dependencies and risks**: Breaking changes, third-party concerns
- **Recommended approach**: Step-by-step implementation strategy
- **Phases**: If complex, break into ordered phases

If the user provides modification feedback, revise the plan and call submit_plan again with the updated plan_content.`,
  tools: [
    'read_file',
    'search_files',
    'search_code',
    'fetch_url',
    'tool_search',
    'submit_plan',
    'dispatch_agent',
  ],
  maxSteps: 180,
};

export const BUILD_PROFILE: AgentProfile = {
  name: 'build',
  description:
    'Default build agent: full read/write access. Implements changes the user has approved.',
  permissionMode: 'default',
  tools: [
    'read_file',
    'write_file',
    'edit_file',
    'execute_command',
    'search_files',
    'search_code',
    'fetch_url',
    'web_search',
    'todo_write',
    'tool_search',
    'dispatch_agent',
  ],
  maxSteps: 180,
};
