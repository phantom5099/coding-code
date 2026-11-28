import { Layer, Effect } from 'effect';
import { resolve } from 'path';
import { ShadowGit } from './shadow-git.js';
import { normalizePath } from '@codingcode/util';
import { commitMsg, rollbackSnapshotMsg, toGitPath, ProjectCache } from './utils.js';
import {
  getTurnsWithBaseline,
  getRollbackToTurnPlan,
  findLatestRollbackSnapshot,
  findRollbackSnapshot,
} from './turn-query.js';
import { emptyRollbackResult, executeRollback } from './rollback-engine.js';
import {
  CheckpointService,
  type CheckpointTarget,
  type EnsureBaselineCommand,
  type RevertCheckpointCommand,
} from './port.js';

const shadowGitByProject = new ProjectCache<ShadowGit>(10);

function getShadowGit(projectPath: string): ShadowGit {
  const normalized = normalizePath(projectPath);
  return shadowGitByProject.get(normalized, () => {
    const sg = new ShadowGit(normalized);
    sg.init();
    return sg;
  });
}

class SessionShadowRepo {
  readonly sg: ShadowGit;
  readonly projectPath: string;
  readonly sessionId: string;

  constructor(target: CheckpointTarget) {
    this.sg = getShadowGit(target.cwd);
    this.projectPath = target.cwd;
    this.sessionId = target.sessionId;
  }

  latestBaselineTurn(): number {
    const turns = getTurnsWithBaseline(this.sg, this.sessionId);
    return turns.length > 0 ? turns[turns.length - 1]! : 0;
  }

  baselineCommit(turnId: number): string | null {
    return this.sg.findCommitByMessage(commitMsg(this.sessionId, turnId));
  }

  ensureBaseline(turnId: number): void {
    if (this.baselineCommit(turnId)) return;
    this.sg.stageAll();
    const hasHead = this.sg.git('rev-parse', '--verify', 'HEAD').status === 0;
    const hasChanges = !hasHead || this.sg.git('diff', '--cached', '--quiet', 'HEAD').status !== 0;
    if (hasChanges && !this.sg.isTooLargeForSnapshot()) {
      this.sg.commit(commitMsg(this.sessionId, turnId));
    }
  }

  ensureRollbackSnapshot(turnId: number): void {
    if (findRollbackSnapshot(this.sg, { sessionId: this.sessionId, turnId })) return;
    this.sg.stageAll();
    if (this.sg.isTooLargeForSnapshot()) return;
    this.sg.commit(rollbackSnapshotMsg(this.sessionId, turnId));
  }

  planRollback(turnId: number) {
    return getRollbackToTurnPlan(this.sg, { sessionId: this.sessionId, turnId });
  }

  latestRollbackSnapshot() {
    return findLatestRollbackSnapshot(this.sg, this.sessionId);
  }

  resolveFile(relFile: string): string {
    return resolve(this.projectPath, relFile);
  }
}

export const CheckpointLayer = Layer.effect(
  CheckpointService,
  Effect.sync(() => ({
    ensureBaseline: (cmd: EnsureBaselineCommand) =>
      Effect.sync(() => {
        new SessionShadowRepo(cmd.target).ensureBaseline(cmd.turnId);
      }),

    getCheckpointDiff: (target: CheckpointTarget, turnId?: number) =>
      Effect.sync(() => {
        const repo = new SessionShadowRepo(target);
        repo.sg.stageAll();
        const latestTurnId = turnId ?? repo.latestBaselineTurn();
        if (latestTurnId === 0) return { turnId: 0, files: [] };

        const baseline = repo.baselineCommit(latestTurnId);
        if (!baseline) return { turnId: latestTurnId, files: [] };

        const files = repo.sg.diffNameStatusAgainstWorkspace(baseline).map((c) => {
          const f = normalizePath(repo.resolveFile(c.file));
          const relPath = toGitPath(repo.sg.projectPath, f);
          const diffText = repo.sg.git('diff', baseline, '--', relPath).stdout;
          let insertions = 0;
          let deletions = 0;
          for (const line of diffText.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) insertions++;
            else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
          }
          return { path: f, status: c.status, diff: diffText, insertions, deletions };
        });

        return { turnId: latestTurnId, files };
      }),

    revertCheckpointFiles: (cmd: RevertCheckpointCommand) =>
      Effect.sync(() => {
        const repo = new SessionShadowRepo(cmd.target);
        repo.sg.stageAll();
        const targetTurnId = cmd.turnId ?? repo.latestBaselineTurn();
        if (targetTurnId === 0) return emptyRollbackResult(0);
        const plan = repo.planRollback(targetTurnId);
        if (!plan) return emptyRollbackResult(targetTurnId);

        const files = cmd.files ?? [];
        const selected =
          files.length > 0
            ? files
            : repo.sg.diffNameStatusAgainstWorkspace(plan.baseline).map((c) => repo.resolveFile(c.file));
        if (selected.length === 0) {
          return {
            reverted: true,
            throughTurnId: targetTurnId,
            affectedTurns: plan.affectedTurns,
            selectedFiles: [],
          };
        }
        repo.ensureRollbackSnapshot(repo.latestBaselineTurn());
        return executeRollback(repo.sg, { plan, selectedFiles: selected });
      }),

    previewRollbackDiff: (target: CheckpointTarget, throughTurnId: number) =>
      Effect.sync(() => {
        const repo = new SessionShadowRepo(target);
        repo.sg.stageAll();
        const plan = repo.planRollback(throughTurnId);
        if (!plan) return { throughTurnId, affectedTurns: [], diff: '' };

        const diff = repo.sg.git('diff', plan.baseline).stdout;
        return { throughTurnId, affectedTurns: plan.affectedTurns, diff };
      }),

    undoRollback: (target: CheckpointTarget, files?: readonly string[]) =>
      Effect.sync(() => {
        const repo = new SessionShadowRepo(target);
        const currentTurnId = repo.latestBaselineTurn();
        if (currentTurnId === 0) return emptyRollbackResult(0);
        const snapshot = repo.latestRollbackSnapshot();
        if (!snapshot || snapshot.rollbackTurnId !== currentTurnId) {
          return emptyRollbackResult(currentTurnId);
        }

        let selected: readonly string[] = files ?? [];
        if (selected.length === 0) {
          const baseline = repo.baselineCommit(currentTurnId);
          if (!baseline) return emptyRollbackResult(currentTurnId);
          selected = repo.sg
            .diffFiles({ from: baseline, to: snapshot.commit })
            .map((c) => repo.resolveFile(c.file));
          if (selected.length === 0) return emptyRollbackResult(currentTurnId);
        }

        repo.sg.checkoutFiles(snapshot.commit, selected);
        repo.sg.stageAll();
        return {
          reverted: true,
          throughTurnId: currentTurnId,
          affectedTurns: [],
          selectedFiles: [...selected],
        };
      }),
  }))
);
