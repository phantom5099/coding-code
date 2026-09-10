export type PermissionMode = 'default' | 'acceptEdits' | 'bypass';

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypass',
] as const;

// plan 权限模式只允许这组工具（只读 + submit_plan），其余一律 deny。
// 作为审批层的权威白名单，agent 侧的工具可见性名单也从这里派生。
export const PLAN_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'search_files',
  'search_code',
  'fetch_url',
  'submit_plan',
]);

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
