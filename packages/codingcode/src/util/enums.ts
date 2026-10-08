export const PLAN_PROFILE_NAME = 'plan' as const;
export const BUILD_PROFILE_NAME = 'build' as const;

export const PROFILE_NAMES = [PLAN_PROFILE_NAME, BUILD_PROFILE_NAME] as const;

export type ProfileName = (typeof PROFILE_NAMES)[number];

export function isPlanProfile(name: string | null | undefined): boolean {
  return name === PLAN_PROFILE_NAME;
}

export const ASK_BEFORE_EXEC_PERMISSION_MODE = 'askBeforeExec' as const;
export const BYPASS_PERMISSION_MODE = 'bypass' as const;

export const PERMISSION_MODES = [ASK_BEFORE_EXEC_PERMISSION_MODE, BYPASS_PERMISSION_MODE] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];
