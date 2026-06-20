import type { UserHookConfig } from '../hooks/types.js';
import type { PermissionMode } from '../approval/types.js';

export interface AgentProfile {
  name: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
  mcpServers?: string[];
  readonly?: boolean;
  permissionMode?: PermissionMode;
  maxSteps?: number;
  model?: string;
  hooks?: UserHookConfig[];
  disabled?: boolean;
  isPrimary?: boolean;
}
