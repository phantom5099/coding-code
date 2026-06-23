import type { DecisionHandler } from '../hooks/types.js';

// ---- Profile name constants + structural helper ----

export const PLAN_PROFILE_NAME = 'plan' as const;
export const BUILD_PROFILE_NAME = 'build' as const;

export function isPlanProfile(p: { name: string } | null | undefined): boolean {
  return p?.name === PLAN_PROFILE_NAME;
}

export const PLAN_MODE_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'submit_plan',
  'dispatch_agent',
]);

// ---- Plan-mode side channel ----

const planModeSessions = new Set<string>();

export function markSessionPlanMode(sessionId: string, isPlanMode: boolean): void {
  if (isPlanMode) planModeSessions.add(sessionId);
  else planModeSessions.delete(sessionId);
}

export function isSessionInPlanMode(sessionId: string): boolean {
  return planModeSessions.has(sessionId);
}

export function clearPlanModeSession(sessionId: string): void {
  planModeSessions.delete(sessionId);
}

// ---- Plan-mode subagent whitelist (called inline by dispatch_agent) ----

export function checkSubagentAllowedInPlanMode(
  parentSessionId: string | undefined,
  parentMainProfile: string | undefined,
  profile: string | undefined
): { allowed: true } | { allowed: false; reason: string } {
  if (!parentSessionId) return { allowed: true };
  if (parentMainProfile !== PLAN_PROFILE_NAME) return { allowed: true };
  if (!profile) return { allowed: true };
  if (profile === 'explore') return { allowed: true };
  return {
    allowed: false,
    reason: `Plan mode can only dispatch the 'explore' subagent. Got: '${profile}'`,
  };
}

export const planModeGateHook: DecisionHandler = (payload) => {
  const sessionId = payload.sessionId as string | undefined;
  if (!sessionId) return null;
  if (!isSessionInPlanMode(sessionId)) return null;

  const toolName = payload.toolName as string | undefined;
  if (!toolName) return null;
  if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) return null;

  return {
    decision: 'deny',
    reason: 'Write operations denied in plan mode. Use submit_plan to submit a plan.',
  };
};

