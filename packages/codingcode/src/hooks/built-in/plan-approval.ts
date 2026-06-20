import type { HookDecision, DecisionHandler } from '../types.js';

/**
 * System hook: triggers a 3-option approval modal (Implement / Modify / Cancel)
 * when the model calls `submit_plan`. The payload carries the plan_content to the
 * UI so it can render a preview.
 */
export const planApprovalHook: DecisionHandler = (payload) => {
  const toolName = payload.toolName as string | undefined;
  const args = (payload.args ?? {}) as { plan_content?: string };
  if (toolName !== 'submit_plan') return null;
  if (!args.plan_content) return null;
  return {
    decision: 'ask',
    reason: 'plan_approval_required',
    payload: {
      plan_content: args.plan_content,
      session_id: payload.sessionId,
      project_path: payload.projectPath,
    },
  };
};
