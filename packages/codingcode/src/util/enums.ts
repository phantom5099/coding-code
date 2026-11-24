export const ASK_BEFORE_EXEC_PERMISSION_MODE = 'askBeforeExec' as const;
export const BYPASS_PERMISSION_MODE = 'bypass' as const;
export const UNRESTRICTED_PERMISSION_MODE = 'unrestricted' as const;

export const PERMISSION_MODES = [
  ASK_BEFORE_EXEC_PERMISSION_MODE,
  BYPASS_PERMISSION_MODE,
  UNRESTRICTED_PERMISSION_MODE,
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];
