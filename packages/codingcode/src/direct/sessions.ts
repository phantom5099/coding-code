import { Effect } from 'effect';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { SessionService } from '../session/store.js';
import { ProjectRuntimeService, modeToProfile } from '../runtime/project-runtime.js';
import { deleteSession } from '../session/file-ops.js';
import { encodeProjectPath, getProjectBaseDir } from '../core/path.js';
import type { PermissionMode } from '../approval/types.js';
import type {
  CheckpointDiff,
  CodeRollbackResult,
  CodeRollbackUndoResult,
  RollbackPreviewDiff,
  RollbackState,
} from '../checkpoint/types.js';
import type { SessionEvent, SessionIndex, SessionMode } from '../session/types.js';
import type { AppRuntime } from '../layer.js';

export interface SessionClient {
  createSession(input: {
    cwd: string;
    mode: SessionMode;
    permissionMode: PermissionMode;
    model: string;
  }): Promise<{ sessionId: string }>;
  resumeSession(input: { sessionId: string; cwd: string }): Promise<SessionEvent[]>;
  listSessions(input: { cwd: string }): Promise<SessionIndex[]>;
  getSessionHistory(input: { sessionId: string; cwd: string }): Promise<SessionEvent[]>;

  deleteSession(input: { sessionId: string; cwd: string }): Promise<void>;
  getSessionMode(input: { sessionId: string; cwd: string }): Promise<{
    mode: SessionMode;
    permissionMode: PermissionMode;
    cwd: string;
    available: Array<{ name: string; description: string }>;
  }>;
  setSessionMode(input: {
    sessionId: string;
    cwd: string;
    mode: SessionMode;
  }): Promise<{ mode: SessionMode; permissionMode: PermissionMode }>;
  getSessionPermissionMode(input: { sessionId: string; cwd: string }): Promise<PermissionMode>;
  setSessionPermissionMode(input: {
    sessionId: string;
    cwd: string;
    mode: PermissionMode;
  }): Promise<void>;
  getSessionPlan(input: {
    sessionId: string;
    cwd: string;
  }): Promise<{ content: string; path: string; directory: string; exists: boolean }>;

  getCheckpointDiff(input: {
    sessionId: string;
    cwd: string;
    turnId?: number;
  }): Promise<CheckpointDiff>;
  revertCheckpointFiles(input: {
    sessionId: string;
    cwd: string;
    files: string[];
  }): Promise<CodeRollbackResult>;
  previewRollbackDiff(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<RollbackPreviewDiff>;
  rollbackCodeToTurn(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<CodeRollbackResult>;
  rollbackContext(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<{ turns: SessionEvent[]; rollbackState: RollbackState }>;
  rollbackBothToTurn(input: { sessionId: string; cwd: string; throughTurnId: number }): Promise<{
    turns: SessionEvent[];
    codeResult: CodeRollbackResult;
    rollbackState: RollbackState;
  }>;
  undoLastCodeRollback(input: {
    sessionId: string;
    cwd: string;
    force?: boolean;
    files?: string[];
  }): Promise<CodeRollbackUndoResult>;
  getRollbackState(input: { sessionId: string; cwd: string }): Promise<RollbackState>;
  forkSession(input: {
    sessionId: string;
    cwd: string;
    atTurnId?: number;
  }): Promise<{ sessionId: string; turns: SessionEvent[] }>;
}

export function createDirectSessionClient(rt: AppRuntime): SessionClient {
  return {
    async createSession({ cwd, mode, permissionMode, model }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.createSessionWithProfile(cwd, {
            model,
            mode,
            permissionMode,
          });
          return { sessionId: state.sessionId };
        })
      );
    },

    async resumeSession({ sessionId, cwd }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          return yield* session.readHistory(state);
        })
      );
    },

    async listSessions({ cwd }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          return yield* session.listSessions(cwd);
        })
      );
    },

    async getSessionHistory({ sessionId, cwd }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          return yield* session.readHistory(state);
        })
      );
    },

    async deleteSession({ sessionId, cwd }) {
      deleteSession(sessionId, cwd);
    },

    async getSessionMode({ sessionId, cwd }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          return {
            mode: state.mode,
            permissionMode: state.permissionMode,
            cwd,
            available: [
              { name: 'plan', description: 'Planning agent' },
              { name: 'build', description: 'Default build agent' },
            ],
          };
        })
      );
    },

    async setSessionMode({ sessionId, cwd, mode }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          yield* session.setModeOnDisk(cwd, sessionId, mode);
          const profile = modeToProfile(mode);
          yield* session.setActiveProfile(cwd, sessionId, profile.name);
          const state = yield* session.load(cwd, sessionId);
          return { mode: state.mode, permissionMode: state.permissionMode };
        })
      );
    },

    async getSessionPermissionMode({ sessionId, cwd }): Promise<PermissionMode> {
      const mode = await rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          return yield* session.getPermissionMode(state);
        })
      );
      return mode as PermissionMode;
    },

    async setSessionPermissionMode({ sessionId, cwd, mode }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          yield* session.setPermissionMode(state, mode);
        })
      );
    },

    async getSessionPlan({ cwd }) {
      const planDir = join(getProjectBaseDir(), encodeProjectPath(cwd));
      if (!existsSync(planDir)) {
        return { content: '', path: '', directory: planDir, exists: false };
      }
      let latest: { path: string; mtime: number } | null = null;
      for (const name of readdirSync(planDir)) {
        if (!name.endsWith('.md')) continue;
        const full = join(planDir, name);
        const mtime = statSync(full).mtimeMs;
        if (latest === null || mtime > latest.mtime) {
          latest = { path: full, mtime };
        }
      }
      if (latest === null) {
        return { content: '', path: '', directory: planDir, exists: false };
      }
      const content = readFileSync(latest.path, 'utf8');
      return { content, path: latest.path, directory: planDir, exists: true };
    },

    async getCheckpointDiff() {
      return { turnId: 0, files: [] };
    },
    async revertCheckpointFiles() {
      return {
        reverted: false,
        throughTurnId: 0,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      };
    },
    async previewRollbackDiff() {
      return { throughTurnId: 0, affectedTurns: [], diff: '' };
    },
    async rollbackCodeToTurn() {
      return {
        reverted: false,
        throughTurnId: 0,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      };
    },
    async rollbackContext() {
      return {
        turns: [] as SessionEvent[],
        rollbackState: {
          context: { active: false, currentThroughTurnId: null },
          code: {
            canUndoLast: false,
            lastEntry: null,
            revertedFiles: [] as string[],
            lastEntryId: null,
          },
        } as RollbackState,
      };
    },
    async rollbackBothToTurn() {
      return {
        turns: [] as SessionEvent[],
        codeResult: {
          reverted: false,
          throughTurnId: 0,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        },
        rollbackState: {
          context: { active: false, currentThroughTurnId: null },
          code: {
            canUndoLast: false,
            lastEntry: null,
            revertedFiles: [] as string[],
            lastEntryId: null,
          },
        } as RollbackState,
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
    async forkSession({ sessionId, cwd, atTurnId }) {
      const newSessionId = await rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          return yield* session.forkSession(state, atTurnId ?? 0);
        })
      );
      return { sessionId: newSessionId, turns: [] as SessionEvent[] };
    },
  };
}
