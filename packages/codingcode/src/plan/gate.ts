import type { DecisionHandler } from '../hooks/types.js';
import { PLAN_MODE_ALLOWED_TOOLS } from './policy.js';
import { isSessionInPlanMode } from './active-sessions.js';

/**
 * System hook: enforces the plan-mode tool allowlist on `tool.approval.pre`.
 *
 * In plan mode, only tools in `PLAN_MODE_ALLOWED_TOOLS` may run. Any other
 * tool (e.g. `write_file`, `execute_command`, `edit_file`) is denied with
 * a plan-specific reason. The `submit_plan` and `dispatch_agent` tools are
 * allowed through here; `dispatch_agent` is further constrained by
 * `planSubagentWhitelistHook` to only dispatch `explore`.
 *
 * The gate runs at a low priority (-1000) so it executes before
 * `planApprovalHook` (priority 1000) but after any other system decision
 * hooks. The session's plan-mode state is read synchronously from the
 * `plan/active-sessions` side channel, which the runtime keeps in sync
 * whenever it switches a session's profile.
 */
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
