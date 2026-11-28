export const ASK_BEFORE_EXEC_PERMISSION_MODE = 'askBeforeExec' as const;
export const BYPASS_PERMISSION_MODE = 'bypass' as const;
export const UNRESTRICTED_PERMISSION_MODE = 'unrestricted' as const;

export const PERMISSION_MODES = [
  ASK_BEFORE_EXEC_PERMISSION_MODE,
  BYPASS_PERMISSION_MODE,
  UNRESTRICTED_PERMISSION_MODE,
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
}

export type ApprovalAction = 'file' | 'exec' | 'network' | 'mcp' | 'subagent' | 'sandbox' | 'other';

export type ConfigSource = 'global' | 'project';

export type ConfigScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly projectPath: string };

export const GLOBAL_CONFIG_SCOPE: ConfigScope = { kind: 'global' };

export function projectConfigScope(projectPath: string): ConfigScope {
  return { kind: 'project', projectPath };
}

/** 挂起等待/回流的双键（审批确认、ask_user 共用），避免 (id, sessionId) 位置传反 */
export interface PendingCallKey {
  readonly callId: string;
  readonly sessionId: string;
}

/** 按键排序的确定性 JSON 序列化，用于参数摘要与策略指纹 */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}
