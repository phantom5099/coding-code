import type { UserHookConfig } from '../hooks/types.js';
import type { PermissionMode } from '../approval/types.js';

/**
 * Permission modes that may be declared on an `AgentProfile`. The `'plan'`
 * mode lives in the `plan/` module and is detected structurally via
 * `isPlanProfile(profile)` rather than via this field.
 */
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
  isPrimary?: boolean;
}
