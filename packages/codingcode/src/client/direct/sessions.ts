import { Effect } from 'effect';
import { SessionService } from '../../session/store.js';
import { deleteSession } from '../../session/io.js';
import { getWorkspaceCwd } from '../../core/workspace.js';
import type { PermissionMode } from '../../approval/types.js';

export interface SessionClient {
  createSession(input: {
    cwd: string;
    initialPermissionMode?: string;
  }): Promise<{ sessionId: string }>;
  resumeSession(input: { sessionId: string; cwd: string }): Promise<any>;
  listSessions(input: { cwd: string }): Promise<any[]>;
  getSessionHistory(input: { sessionId: string }): Promise<any[]>;
  deleteSession(input: { sessionId: string }): Promise<void>;
  getSessionPermissionMode(input: { sessionId: string }): Promise<PermissionMode>;
  setSessionPermissionMode(input: { sessionId: string; mode: PermissionMode }): Promise<void>;

  getCheckpointDiff(input: { sessionId: string; cwd: string; turnId?: number }): Promise<any>;
  revertCheckpointFile(input: { sessionId: string; cwd: string; file: string }): Promise<any>;
  revertCheckpointFiles(input: { sessionId: string; cwd: string; files: string[] }): Promise<any>;
  revertCheckpointAgentFiles(input: { sessionId: string; cwd: string }): Promise<any>;
  revertCheckpointAllFiles(input: { sessionId: string; cwd: string }): Promise<any>;
  previewRollbackDiff(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<any>;
  rollbackCodeToTurn(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<any>;
  rollbackContext(input: { sessionId: string; cwd: string; throughTurnId: number }): Promise<any>;
  rollbackBothToTurn(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<any>;
  undoLastCodeRollback(input: {
    sessionId: string;
    cwd: string;
    force?: boolean;
    files?: string[];
  }): Promise<any>;
  getRollbackState(input: { sessionId: string; cwd: string }): Promise<any>;
  forkSession(input: {
    sessionId: string;
    cwd: string;
    atUuid?: string;
  }): Promise<{ sessionId: string; turns: any[] }>;
}

export function createDirectSessionClient(
  runWithLayer: <T>(eff: any) => Promise<T>
): SessionClient {
  return {
    async createSession({ cwd, initialPermissionMode }) {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(cwd, 'unknown');
          return { sessionId: state.sessionId };
        })
      );
    },

    async resumeSession({ sessionId, cwd }) {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(cwd, 'unknown', sessionId);
          return yield* svc.readHistory(state);
        })
      );
    },

    async listSessions({ cwd }) {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.listSessions(cwd);
        })
      );
    },

    async getSessionHistory({ sessionId }) {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(getWorkspaceCwd(), 'unknown', sessionId);
          return yield* svc.readHistory(state);
        })
      );
    },

    async deleteSession({ sessionId }) {
      deleteSession(sessionId);
    },

    async getSessionPermissionMode({ sessionId }) {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(getWorkspaceCwd(), 'unknown', sessionId);
          return yield* svc.getPermissionMode(state);
        })
      );
    },

    async setSessionPermissionMode({ sessionId, mode }) {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(getWorkspaceCwd(), 'unknown', sessionId);
          return yield* svc.setPermissionMode(state, mode);
        })
      );
    },

    async getCheckpointDiff() {
      return { turnId: 0, files: [] };
    },
    async revertCheckpointFile() {
      return {
        reverted: false,
        throughTurnId: 0,
        baseTurnId: null,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      };
    },
    async revertCheckpointFiles() {
      return {
        reverted: false,
        throughTurnId: 0,
        baseTurnId: null,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      };
    },
    async revertCheckpointAgentFiles() {
      return {
        reverted: false,
        throughTurnId: 0,
        baseTurnId: null,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      };
    },
    async revertCheckpointAllFiles() {
      return {
        reverted: false,
        throughTurnId: 0,
        baseTurnId: null,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      };
    },
    async previewRollbackDiff() {
      return { throughTurnId: 0, baseTurnId: null, affectedTurns: [], diff: '' };
    },
    async rollbackCodeToTurn() {
      return {
        reverted: false,
        throughTurnId: 0,
        baseTurnId: null,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      };
    },
    async rollbackContext() {
      return { turns: [], rollbackState: {} };
    },
    async rollbackBothToTurn() {
      return {
        turns: [],
        codeResult: {
          reverted: false,
          throughTurnId: 0,
          baseTurnId: null,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        },
        rollbackState: {},
      };
    },
    async undoLastCodeRollback() {
      return {
        restored: false,
        conflict: false,
        conflictFiles: [],
        restoredFiles: [],
        remainingRolledBack: [],
      };
    },
    async getRollbackState() {
      return {
        context: { active: false, currentThroughTurnId: null },
        code: { canUndoLast: false, lastEntry: null, revertedFiles: [], lastEntryId: null },
      };
    },
    async forkSession({ sessionId, atUuid }) {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(getWorkspaceCwd(), 'unknown', sessionId);
          return yield* svc.forkSession(state, atUuid ?? '');
        })
      );
    },
  };
}
