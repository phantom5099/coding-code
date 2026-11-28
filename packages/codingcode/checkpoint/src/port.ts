import { Context } from 'effect';
import type { Effect } from 'effect';
import type { SessionKey } from '@codingcode/session';
import type { CheckpointDiff, CodeRollbackResult, RollbackPreviewDiff } from './types.js';

export type CheckpointTarget = SessionKey;

export interface EnsureBaselineCommand {
  readonly target: CheckpointTarget;
  readonly turnId: number;
}

export interface RevertCheckpointCommand {
  readonly target: CheckpointTarget;
  readonly turnId?: number;
  readonly files?: readonly string[];
}

export interface CheckpointShape {
  ensureBaseline(cmd: EnsureBaselineCommand): Effect.Effect<void>;
  getCheckpointDiff(target: CheckpointTarget, turnId?: number): Effect.Effect<CheckpointDiff>;
  revertCheckpointFiles(cmd: RevertCheckpointCommand): Effect.Effect<CodeRollbackResult>;
  previewRollbackDiff(
    target: CheckpointTarget,
    throughTurnId: number
  ): Effect.Effect<RollbackPreviewDiff>;
  undoRollback(target: CheckpointTarget, files?: readonly string[]): Effect.Effect<CodeRollbackResult>;
}

export class CheckpointService extends Context.Tag('Checkpoint')<
  CheckpointService,
  CheckpointShape
>() {}
