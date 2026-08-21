import { readFileSync } from 'fs';
import type { DecisionHandler } from '../hooks/types.js';
import { computePaths } from '../core/path.js';

// ---- Profile name constants + structural helper ----

export const PLAN_PROFILE_NAME = 'plan' as const;
export const BUILD_PROFILE_NAME = 'build' as const;

export function isPlanProfile(p: { name: string } | null | undefined): boolean {
  return p?.name === PLAN_PROFILE_NAME;
}

export const PLAN_MODE_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'search_files',
  'search_code',
  'fetch_url',
  'submit_plan',
]);

// ---- Plan-mode state: read from .index.json (disk is single source of truth) ----

export function isSessionInPlanMode(sessionId: string, cwd: string): boolean {
  try {
    const paths = computePaths(cwd, sessionId);
    const idx = JSON.parse(readFileSync(paths.indexPath, 'utf8')) as {
      mode?: string;
    };
    return idx?.mode === 'plan';
  } catch {
    return false;
  }
}

export const planModeGateHook: DecisionHandler = (payload) => {
  const sessionId = payload.sessionId as string | undefined;
  const projectPath = payload.projectPath as string | undefined;
  if (!sessionId || !projectPath) return null;
  if (!isSessionInPlanMode(sessionId, projectPath)) return null;

  const toolName = payload.toolName as string | undefined;
  if (!toolName) return null;
  if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) return null;

  return {
    decision: 'deny',
    reason: 'Write operations denied in plan mode. Use submit_plan to submit a plan.',
  };
};
