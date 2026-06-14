import type { UserHookConfig } from '../hooks/types.js';

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
