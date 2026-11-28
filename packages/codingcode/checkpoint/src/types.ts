export interface CheckpointFileDiff {
  readonly path: string;
  readonly status: string;
  readonly diff: string;
  readonly insertions: number;
  readonly deletions: number;
}

export interface CheckpointDiff {
  readonly turnId: number;
  readonly files: CheckpointFileDiff[];
}

export interface CodeRollbackResult {
  readonly reverted: boolean;
  readonly throughTurnId: number;
  readonly affectedTurns: number[];
  readonly selectedFiles: string[];
}

export interface RollbackPreviewDiff {
  readonly throughTurnId: number;
  readonly affectedTurns: number[];
  readonly diff: string;
}

export interface RestorePlan {
  readonly throughTurnId: number;
  readonly affectedTurns: number[];
  readonly baseline: string;
}

export interface RollbackSnapshot {
  readonly rollbackTurnId: number;
  readonly commit: string;
}

export interface GitFileChange {
  readonly status: string;
  readonly file: string;
}

export interface GitExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
}
