import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentProfile } from './types.js';
import { createLogger } from '@codingcode/infra/logger';

export interface MainAgentProfile extends AgentProfile {
  mcpServers?: string[];
}

export function loadMainAgentProfile(projectCwd: string): MainAgentProfile | undefined {
  const paths = [
    join(projectCwd, '.codingcode', 'agents', 'main.yaml'),
    join(homedir(), '.codingcode', 'agents', 'main.yaml'),
  ];

  for (const mainYaml of paths) {
    if (!existsSync(mainYaml)) continue;
    try {
      const data = parseYaml(readFileSync(mainYaml, 'utf-8')) as Record<string, unknown>;
      return {
        name: (data.name as string) ?? 'default-main',
        description: (data.description as string) ?? 'Default project assistant',
        systemPrompt: typeof data.systemPrompt === 'string' ? data.systemPrompt : undefined,
        mcpServers: Array.isArray(data.mcpServers) ? data.mcpServers.map(String) : undefined,
        readonly: Boolean(data.readonly),
        permissionMode:
          data.permissionMode === 'default' ||
          data.permissionMode === 'acceptEdits' ||
          data.permissionMode === 'bypass'
            ? data.permissionMode
            : undefined,
        maxSteps: typeof data.maxSteps === 'number' ? data.maxSteps : undefined,
        model: typeof data.model === 'string' ? data.model : undefined,
        hooks: Array.isArray(data.hooks) ? (data.hooks as any[]) : undefined,
      };
    } catch (err) {
      createLogger().warn(`Failed to parse main.yaml at ${mainYaml}:`, err);
    }
  }
  return undefined;
}
