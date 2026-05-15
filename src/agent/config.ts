import { getPromptSet } from '../prompts';
import type { AgentRole } from '../prompts';
import { getAllRules } from '../rules';
import type { AgentConfig } from './types';

export interface ResolvedConfig {
  role: string;
  systemPrompt: string;
  maxSteps: number;
  availableTools?: string[];
}

export function resolveConfig(role: string): ResolvedConfig {
  const ps = getPromptSet(role as AgentRole);
  let systemPrompt = ps.buildSystem({
    cwd: process.cwd(),
    platform: process.platform,
    shell: process.env.SHELL || process.env.ComSpec || 'bash',
  });

  const rules = getAllRules();
  if (rules) {
    systemPrompt += `\n\n## User-defined Rules\n\nThe following rules MUST be followed at all times. They override any conflicting instructions above.\n\n${rules}`;
  }

  return {
    role,
    systemPrompt,
    maxSteps: ps.maxSteps ?? 15,
    availableTools: ps.toolNames,
  };
}

export function mergeConfig(base: ResolvedConfig, override: Partial<AgentConfig>): ResolvedConfig {
  return {
    ...base,
    systemPrompt: override.systemPrompt ?? base.systemPrompt,
    maxSteps: override.maxSteps ?? base.maxSteps,
    availableTools: override.availableTools ?? base.availableTools,
  };
}
