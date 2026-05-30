export { ShadowGit, normalizePath } from './shadow-git.js';
export { encodeProjectPath } from '../core/path.js';
export { Ledger } from './ledger.js';
export { CheckpointService } from './checkpoint-service.js';
export type { CheckpointDiff, CodeRollbackResult, CodeRollbackUndoResult, RollbackPreviewDiff, CodeRestoreEntry } from './checkpoint-service.js';
export { toGitPath, hashWorkspaceFile } from './checkpoint-service.js';
export { bootstrapCheckpoint } from './bootstrap.js';
export { bootstrapDiffTracker, getPendingDiff } from './diff-tracker.js';
export type { DiffResult } from './diff-tracker.js';
