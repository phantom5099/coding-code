import { Context } from 'effect';
import type { Effect } from 'effect';
import type { CheckpointDiff, CodeRollbackResult, RollbackPreviewDiff } from './types.js';

export interface CheckpointShape {
  snapshotBaseline(projectPath: string, sessionId: string, turnId: number): Effect.Effect<void>;
  snapshotFinal(projectPath: string, sessionId: string, turnId: number): Effect.Effect<void>;
  getCheckpointDiff(projectPath: string, sessionId: string, turnId?: number): Effect.Effect<CheckpointDiff>;
  revertCheckpointFiles(projectPath: string, sessionId: string, turnId: number | undefined, files: string[]): Effect.Effect<CodeRollbackResult>;
  previewRollbackDiff(projectPath: string, sessionId: string, throughTurnId: number): Effect.Effect<RollbackPreviewDiff>;
  rollbackCodeToTurn(projectPath: string, sessionId: string, throughTurnId: number): Effect.Effect<CodeRollbackResult>;
}

export class CheckpointService extends Context.Tag('Checkpoint')<CheckpointService, CheckpointShape>() {}
