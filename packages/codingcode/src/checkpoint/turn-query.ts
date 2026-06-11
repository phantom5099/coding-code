import type { ShadowGit } from './shadow-git.js';
import { shortSid, commitMsg } from './utils.js';

export interface RestorePlan {
  throughTurnId: number;
  affectedTurns: number[];
  baseline: string;
}

export function getCompletedTurnsFor(sg: ShadowGit, sessionId: string): number[] {
  const short = shortSid(sessionId);
  const result = sg.git('log', '--all', '--format=%s');
  const ids = new Set<number>();
  const re = new RegExp(`^turn-${short}-(\\d+)-final$`);
  for (const line of result.stdout.trim().split('\n')) {
    const m = line.match(re);
    if (m) ids.add(Number(m[1]));
  }
  return [...ids].sort((a, b) => a - b);
}

export function getTurnRestorePlan(
  sg: ShadowGit,
  sessionId: string,
  turnId: number
): RestorePlan | null {
  const baseline = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'baseline'));
  const final = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'final'));
  if (!baseline || !final) return null;
  return {
    throughTurnId: turnId,
    affectedTurns: [],
    baseline,
  };
}

export function getRollbackToTurnPlan(
  sg: ShadowGit,
  sessionId: string,
  throughTurnId: number
): RestorePlan | null {
  const completedTurns = getCompletedTurnsFor(sg, sessionId);
  const affectedTurns = completedTurns.filter((id) => id >= throughTurnId);
  if (affectedTurns.length === 0) return null;

  const baseline = sg.findCommitByMessage(commitMsg(sessionId, throughTurnId, 'baseline'));
  if (!baseline) return null;

  return {
    throughTurnId,
    affectedTurns,
    baseline,
  };
}
