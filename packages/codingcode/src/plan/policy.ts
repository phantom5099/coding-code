/**
 * The set of tool names that may run when the session is in plan mode.
 *
 * `submit_plan` is the only write tool permitted (it persists the plan to
 * disk for user review). `dispatch_agent` is permitted only as a read-only
 * vehicle; the subagent dispatch hook (`plan/subagent-whitelist.ts`)
 * further restricts the dispatched profile to `explore`.
 */
export const PLAN_MODE_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'submit_plan',
  'dispatch_agent',
]);
