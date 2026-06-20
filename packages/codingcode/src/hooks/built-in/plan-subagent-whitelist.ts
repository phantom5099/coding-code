import type { DecisionHandler } from '../types.js';

/**
 * System hook: in plan mode, the planning agent can only dispatch the 'explore'
 * subagent. Any other agent name is denied. This is a hard security boundary —
 * even if the model bypasses the catalog or tool visibility filters, this hook
 * enforces the whitelist at dispatch time.
 */
const PLAN_WHITELIST = new Set(['explore']);

export const planSubagentWhitelistHook: DecisionHandler = (payload) => {
  const profile = payload.profile as string | undefined;
  const parentSessionId = payload.parentSessionId as string | undefined;
  if (!parentSessionId) return null;

  // Inspect the parent's main profile via a module-level accessor set by the runtime.
  // We can't import the runtime here to avoid circular deps, so the runtime injects
  // the current main profile name via the `parentMainProfile` field in the payload.
  const parentMainProfile = (payload as { parentMainProfile?: string }).parentMainProfile;
  if (parentMainProfile !== 'plan') return null;

  if (!profile) return null;
  if (PLAN_WHITELIST.has(profile)) return null;

  return {
    decision: 'deny',
    reason: `Plan mode can only dispatch the 'explore' subagent. Got: '${profile}'`,
  };
};
