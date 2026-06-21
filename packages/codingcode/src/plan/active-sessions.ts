/**
 * Side-channel registry of which sessions are currently in plan mode.
 *
 * The plan-mode gate hook (`plan/gate.ts`) needs synchronous access to
 * "is this session in plan mode?" when it fires on `tool.approval.pre`.
 * `ProjectRuntimeService.getSessionProfile` is synchronous but is only
 * reachable inside an Effect fiber, while `DecisionHandler` cannot
 * yield*. This module bridges the gap: the runtime (or any caller that
 * switches a session's profile) marks the session here, and the gate
 * reads it.
 *
 * The runtime and this registry are kept in sync by the runtime's
 * `setSessionProfile` / `restoreSessionProfile` / `disposeSession`
 * call sites.
 */
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
