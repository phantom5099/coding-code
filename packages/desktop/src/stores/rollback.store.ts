import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { CheckpointDiff } from '../lib/core-api';

interface RollbackState {
  checkpointDiffByTurnId: Record<string, CheckpointDiff>;
  revertedFilesByTurnId: Record<string, string[]>;
  turnCheckpointMapping: Record<string, Record<number, string>>;
}

interface RollbackActions {
  setCheckpointDiff: (threadId: string, turnId: string, diff: CheckpointDiff) => void;
  markFileReverted: (threadId: string, turnId: string, file: string) => void;
  unmarkFileReverted: (threadId: string, turnId: string, file: string) => void;
  setTurnCheckpointMapping: (threadId: string, checkpointId: number, uiTurnId: string) => void;
  cleanupDeletedThreads: (incomingIds: Set<string>) => void;
}

/** 整轮回退的哨兵标记：存在于 revertedFilesByTurnId 即表示该轮被整轮回退 */
export const TURN_SCOPE_REVERTED = '__scope_reverted__';

export const useRollbackStore = create<RollbackState & RollbackActions>()(
  immer((set) => ({
    checkpointDiffByTurnId: {},
    revertedFilesByTurnId: {},
    turnCheckpointMapping: {},

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

    unmarkFileReverted: (threadId, turnId, file) =>
      set((s) => {
        const key = `${threadId}:${turnId}`;
        const list = s.revertedFilesByTurnId[key];
        if (!list) return;
        if (file === TURN_SCOPE_REVERTED) {
          // 整轮撤销：清掉该轮全部文件标记
          delete s.revertedFilesByTurnId[key];
          return;
        }
        s.revertedFilesByTurnId[key] = list.filter((f) => f !== file);
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
