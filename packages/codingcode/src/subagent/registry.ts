import type { AgentProfile } from './types.js';
import { loadConfig, getUserConfigPath } from '@codingcode/infra/config';
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

// ---- SubagentService: in-memory built-in registry ----

export class SubagentService extends Effect.Service<SubagentService>()('Subagent', {
  sync: () => {
    const globalRegistry = new Map<string, AgentProfile>();

    return {
      registerGlobal(profiles: AgentProfile[]): void {
        for (const p of profiles) globalRegistry.set(p.name, p);
      },

      get(_projectPath: string, name: string): AgentProfile | undefined {
        return globalRegistry.get(name);
      },
    };
  },
}) {}

export const PLAN_PROFILE: AgentProfile = {
  name: 'plan',
  description:
    'Planning agent: analyzes the codebase, produces an implementation plan, and submits it via submit_plan for user approval. No business code modifications.',
  systemPrompt: `You are a planning agent. Your role is to analyze the codebase and produce an implementation plan that the user reviews and approves before any code is written.

You can read files and search code. You can submit a plan via the \`submit_plan\` tool — each call overwrites the previous plan file; use it to revise your plan based on user feedback.

In plan mode, write_file / edit_file / execute_command are denied. The only write operation allowed is \`submit_plan\`.

## Research process
1. Understand the project structure and conventions
2. Identify relevant files and existing patterns
3. Analyze dependencies and potential impacts
4. Assess complexity and risks
5. Check for existing implementations or similar patterns

## Output format
When ready, call \`submit_plan({ title, plan_content: "..." })\` with a Markdown plan:
- **Current state**: What exists today
- **Key files**: Files that need modification or creation, with line references
- **Dependencies and risks**: Breaking changes, third-party concerns
- **Recommended approach**: Step-by-step implementation strategy
- **Phases**: If complex, break into ordered phases

## After submit_plan
submit_plan returns synchronously after writing the plan file. Once you have called it, stop and wait for the user's decision — do not call submit_plan again until the user responds, and do not attempt to use any other write tool.

The user's decision arrives as the next user message. The system has already handled the agent-profile switch (plan → build on approval, plan → plan on revise, no change on cancel); the message body itself is your signal:

- "Implement"/"proceed"/"go ahead" (or any explicit approval) — the plan is approved. Acknowledge briefly and stop. The build agent will pick up the plan from the persisted file.
- The body contains a revised plan (a Markdown document, often with explicit section headers, or with a "Revise the plan with these changes:" wrapper) — treat the body as the new plan_content, call \`submit_plan\` again with the same title and the revised content, then stop.
- "Cancel"/"do not implement" — the plan is rejected. Acknowledge briefly and stop.

Never re-call submit_plan on your own initiative. Never treat an implement message as a request for further exploration.`,
  maxSteps: 180,
};

export const BUILD_PROFILE: AgentProfile = {
  name: 'build',
  description:
    'Default build agent: full read/write access. Implements changes the user has approved.',
  permissionMode: 'default',
  maxSteps: 180,
};
