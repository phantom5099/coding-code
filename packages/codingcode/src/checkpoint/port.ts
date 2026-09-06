import { Context } from 'effect';
import type { Effect } from 'effect';

export interface CheckpointShape {
  snapshotBaseline(projectPath: string, sessionId: string, turnId: number): Effect.Effect<void>;
  snapshotFinal(projectPath: string, sessionId: string, turnId: number): Effect.Effect<void>;
  getCompletedTurns(projectPath: string, sessionId: string): Effect.Effect<number[]>;
  getCheckpoints(projectPath: string, sessionId: string): Effect.Effect<Array<{ turnId: number; files: string[] }>>;
  getCheckpointDiff(projectPath: string, sessionId: string, turnId?: number): Effect.Effect<{ turnId: number; files: Array<{ path: string; status: string; diff: string; insertions: number; deletions: number }> }>;
  revertCheckpointFiles(projectPath: string, sessionId: string, turnId: number, files: string[]): Effect.Effect<{ restored: boolean; conflict: boolean; conflictFiles: string[]; restoredFiles: string[]; remainingRolledBack: string[] }>;
  previewRollbackDiff(projectPath: string, sessionId: string, throughTurnId: number): Effect.Effect<{ throughTurnId: number; affectedTurns: number[]; diff: string }>;
  rollbackCodeToTurn(projectPath: string, sessionId: string, throughTurnId: number): Effect.Effect<{ restored: boolean; conflict: boolean; conflictFiles: string[]; restoredFiles: string[]; remainingRolledBack: string[] }>;
  undoLastCodeRollback(projectPath: string, sessionId: string, opts?: { force?: boolean; files?: string[] }): Effect.Effect<{ restored: boolean; conflict: boolean; conflictFiles: string[]; restoredFiles: string[]; remainingRolledBack: string[] }>;
  getLatestRestoreEntry(projectPath: string, sessionId: string): Effect.Effect<{ id: string; turnId: number; selectedFiles: string[] } | null>;
}

export class CheckpointService extends Context.Tag('Checkpoint')<CheckpointService, CheckpointShape>() {}
