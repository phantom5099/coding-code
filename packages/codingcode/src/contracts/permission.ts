export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'bypass',
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const PLAN_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'search_files',
  'search_code',
  'fetch_url',
  'submit_plan',
]);

export type ApprovalDecision =
  | { type: 'deny'; reason: string; source: string }
  | { type: 'allow'; source: string };
