import type { AgentRole, PromptSet } from "./types";
import { coderPromptSet } from "./coder";
import { debuggerPromptSet } from "./debugger";
import { reviewerPromptSet } from "./reviewer";

/** 所有角色配置的注册表 */
const registry: Record<AgentRole, PromptSet> = {
  coder: coderPromptSet,
  debugger: debuggerPromptSet,
  reviewer: reviewerPromptSet,
};

/** 获取指定角色的配置 */
export function getPromptSet(role: AgentRole): PromptSet {
  const entry = registry[role];
  if (!entry) {
    throw new Error(`Unknown agent role: "${role}". Available: ${Object.keys(registry).join(", ")}`);
  }
  return entry;
}

/** 列出所有可用的角色 */
export function listRoles(): { id: AgentRole; label: string; description: string }[] {
  return (Object.keys(registry) as AgentRole[]).map((id) => ({
    id,
    label: registry[id]!.label,
    description: registry[id]!.description,
  }));
}

/** 切换角色（若角色不存在则抛出） */
export function switchRole(role: string): PromptSet {
  return getPromptSet(role as AgentRole);
}

export type { AgentRole, PromptSet } from "./types";
