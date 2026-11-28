import type { ShadowGit } from './shadow-git.js';
import type { RestorePlan, RollbackSnapshot } from './types.js';
import { shortSid, commitMsg, rollbackSnapshotMsg } from './utils.js';

export interface SessionTurnQuery {
  readonly sessionId: string;
  readonly turnId: number;
}

export function getTurnsWithBaseline(sg: ShadowGit, sessionId: string): number[] {
  const short = shortSid(sessionId);
  const result = sg.git('log', '--all', '--format=%s');
  const ids = new Set<number>();
  const re = new RegExp(`^turn-${short}-(\\d+)-baseline$`);
  for (const line of result.stdout.trim().split('\n')) {
    const m = line.match(re);
    if (m) ids.add(Number(m[1]));
  }
  return [...ids].sort((a, b) => a - b);
}

export function getRollbackToTurnPlan(
  sg: ShadowGit,
  query: SessionTurnQuery
): RestorePlan | null {
  const turns = getTurnsWithBaseline(sg, query.sessionId);
  const affectedTurns = turns.filter((id) => id >= query.turnId);
  if (affectedTurns.length === 0) return null;

  const baseline = sg.findCommitByMessage(commitMsg(query.sessionId, query.turnId));
  if (!baseline) return null;

  return {
    throughTurnId: query.turnId,
    affectedTurns,
    baseline,
  };
}

/** 该会话全局 rollbackTurnId 最大的快照 = 最近一次回退前的状态 */
export function findLatestRollbackSnapshot(
  sg: ShadowGit,
  sessionId: string
): RollbackSnapshot | null {
  const short = shortSid(sessionId);
  const result = sg.git('log', '--all', '--format=%H %s');
  const re = new RegExp(`^([a-f0-9]+) turn-${short}-(\\d+)-pre-rollback$`);
  let best: RollbackSnapshot | null = null;
  for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
    const m = line.match(re);
    if (!m) continue;
    const rollbackTurnId = Number(m[2]);
    if (!best || rollbackTurnId > best.rollbackTurnId) {
      best = { rollbackTurnId, commit: m[1]! };
    }
  }
  return best;
}

/** 供 ensure 幂等寻址：当前轮的快照是否已存在 */
export function findRollbackSnapshot(sg: ShadowGit, query: SessionTurnQuery): string | null {
  return sg.findCommitByMessage(rollbackSnapshotMsg(query.sessionId, query.turnId));
}
