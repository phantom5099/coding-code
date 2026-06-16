import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { SessionRollbackState, CheckpointDiff } from '../lib/core-api';

interface RollbackState {
  rollbackStateByThreadId: Record<string, SessionRollbackState>;
  checkpointDiffByTurnId: Record<string, CheckpointDiff>;
  revertedFilesByTurnId: Record<string, string[]>;
  turnCheckpointMapping: Record<string, Record<number, string>>;
}

interface RollbackActions {
  setRollbackState: (threadId: string, state: SessionRollbackState) => void;
  setCheckpointDiff: (threadId: string, turnId: string, diff: CheckpointDiff) => void;
  markFileReverted: (threadId: string, turnId: string, file: string) => void;
  markFileRestored: (threadId: string, turnId: string, file: string) => void;
  initRevertedFilesFromState: (threadId: string) => void;
  setTurnCheckpointMapping: (threadId: string, checkpointId: number, uiTurnId: string) => void;
  cleanupDeletedThreads: (incomingIds: Set<string>) => void;
}

export const useRollbackStore = create<RollbackState & RollbackActions>()(
  immer((set) => ({
    rollbackStateByThreadId: {},
    checkpointDiffByTurnId: {},
    revertedFilesByTurnId: {},
    turnCheckpointMapping: {},

    setRollbackState: (threadId, state) =>
      set((s) => {
        s.rollbackStateByThreadId[threadId] = state as any;
      }),

    setCheckpointDiff: (threadId, turnId, diff) =>
      set((s) => {
        s.checkpointDiffByTurnId[`${threadId}:${turnId}`] = diff as any;
      }),

    markFileReverted: (threadId, turnId, file) =>
      set((s) => {
        const key = `${threadId}:${turnId}`;
        if (!s.revertedFilesByTurnId[key]) {
          s.revertedFilesByTurnId[key] = [];
        }
        if (!s.revertedFilesByTurnId[key].includes(file)) {
          s.revertedFilesByTurnId[key].push(file);
        }
      }),

    markFileRestored: (threadId, turnId, file) =>
      set((s) => {
        const key = `${threadId}:${turnId}`;
        const arr = s.revertedFilesByTurnId[key];
        if (arr) {
          s.revertedFilesByTurnId[key] = arr.filter((f) => f !== file);
        }
      }),

    initRevertedFilesFromState: (threadId) =>
      set((s) => {
        const state = s.rollbackStateByThreadId[threadId];
        if (!state) return;
        const revertedFiles = state.code.revertedFiles ?? [];
        const checkpointTurnId = state.code.lastEntry?.throughTurnId;
        if (revertedFiles.length === 0 || checkpointTurnId === undefined) return;
        const uiTurnId = s.turnCheckpointMapping[threadId]?.[checkpointTurnId];
        if (!uiTurnId) return;
        const key = `${threadId}:${uiTurnId}`;
        s.revertedFilesByTurnId[key] = revertedFiles;
      }),

    setTurnCheckpointMapping: (threadId, checkpointId, uiTurnId) =>
      set((s) => {
        if (!s.turnCheckpointMapping[threadId]) {
          s.turnCheckpointMapping[threadId] = {};
        }
        s.turnCheckpointMapping[threadId][checkpointId] = uiTurnId;
      }),

    cleanupDeletedThreads: (incomingIds) =>
      set((s) => {
        for (const id of Object.keys(s.rollbackStateByThreadId)) {
          if (!incomingIds.has(id)) {
            delete s.rollbackStateByThreadId[id];
          }
        }
        for (const key of Object.keys(s.checkpointDiffByTurnId)) {
          const threadId = key.split(':')[0];
          if (threadId && !incomingIds.has(threadId)) {
            delete s.checkpointDiffByTurnId[key];
          }
        }
        for (const id of Object.keys(s.revertedFilesByTurnId)) {
          const threadId = id.split(':')[0];
          if (threadId && !incomingIds.has(threadId)) {
            delete s.revertedFilesByTurnId[id];
          }
        }
        for (const id of Object.keys(s.turnCheckpointMapping)) {
          if (!incomingIds.has(id)) {
            delete s.turnCheckpointMapping[id];
          }
        }
      }),
  }))
);
