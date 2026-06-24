export type PermissionMode = 'default' | 'acceptEdits' | 'bypass';

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypass',
] as const;

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
}

export interface ToolCallRequest {
  tool: string;
  input: Record<string, unknown>;
  context?: Record<string, unknown>;
  callId?: string;
}

export type ApprovalDecision =
  | { type: 'deny'; reason: string; source: string }
  | { type: 'allow'; source: string };

export type RuleAction = 'deny' | 'allow' | 'ask';

export interface PermissionRule {
  id: string;
  action: RuleAction;
  /** Glob pattern for command name, e.g. "Bash", "Edit" */
  toolPattern: string;
  /** Glob pattern for command arguments serialized as string, e.g. "rm -rf /*" */
  argPattern?: string;
  /** Optional regex pattern for command arguments (alternative to argPattern) */
  argRegex?: RegExp;
  reason?: string;
  priority?: number;
  source?: 'system' | 'user';
}
