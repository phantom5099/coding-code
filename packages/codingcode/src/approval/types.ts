export type PermissionMode = 'default' | 'acceptEdits' | 'dontAsk' | 'plan' | 'bypass';

export interface ToolCallRequest {
  tool: string;
  input: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export type ApprovalDecision =
  | { type: 'deny'; reason: string; source: string }
  | { type: 'allow'; source: string }
  | { type: 'ask'; source: string }
  | { type: 'modified'; input: Record<string, unknown>; source: string }
  | { type: 'continue' };

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

export const READONLY_TOOLS = new Set([
  'read_file',
  'search_code',
  'list_dir',
  'fetch_url',
]);

export const DESTRUCTIVE_TOOLS = new Set([
  'execute_command',
  'Bash',
]);
