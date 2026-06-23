import type { UserHookConfig } from '../hooks/types.js';
import type { PermissionMode } from '../approval/types.js';

export type ProfilePermissionMode = Exclude<PermissionMode, 'plan'>;

export interface AgentProfile {
  name: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
  mcpServers?: string[];
  readonly?: boolean;
  permissionMode?: ProfilePermissionMode;
  maxSteps?: number;
  model?: string;
  hooks?: UserHookConfig[];
  disabled?: boolean;
}
