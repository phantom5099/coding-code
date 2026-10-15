import type { ShadowGit } from './shadow-git.js';
import type { RestorePlan } from './types.js';
import { shortSid, commitMsg, rollbackSnapshotMsg } from './utils.js';

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

export function getTurnRestorePlan(
  sg: ShadowGit,
  sessionId: string,
  turnId: number
): RestorePlan | null {
  const baseline = sg.findCommitByMessage(commitMsg(sessionId, turnId));
  if (!baseline) return null;
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
  const turns = getTurnsWithBaseline(sg, sessionId);
  const affectedTurns = turns.filter((id) => id >= throughTurnId);
  if (affectedTurns.length === 0) return null;

  const baseline = sg.findCommitByMessage(commitMsg(sessionId, throughTurnId));
  if (!baseline) return null;

  return {
    throughTurnId,
    affectedTurns,
    baseline,
  };
}

export function findLatestRollbackSnapshot(
  sg: ShadowGit,
  sessionId: string,
  baselineTurnId: number
): { rollbackTurnId: number; commit: string } | null {
  // 不用 --grep：git 默认 BRE 正则，[0-9]+ 的 + 是字面量，永远匹配不到。
  // 与 getTurnsWithBaseline 同构：--format 全量拉取，JS 侧 ERE 匹配。
  const short = shortSid(sessionId);
  const result = sg.git('log', '--all', '--format=%H %s');
  const re = new RegExp(`^([a-f0-9]+) turn-${short}-(\\d+)-pre-${baselineTurnId}$`);
  let best: { rollbackTurnId: number; commit: string } | null = null;
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

/** 供 ensure 幂等寻址：某个 (当前轮, 目标轮) 组合的快照是否已存在 */
export function findRollbackSnapshot(
  sg: ShadowGit,
  sessionId: string,
  rollbackTurnId: number,
  baselineTurnId: number
): string | null {
  return sg.findCommitByMessage(rollbackSnapshotMsg(sessionId, rollbackTurnId, baselineTurnId));
}
