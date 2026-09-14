import { Effect } from 'effect';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { SessionService } from '../session/port.js';
import type { SessionShape } from '../session/port.js';
import { encodeProjectPath, getProjectBaseDir } from '../core/path.js';
import type { PermissionMode } from '../contracts/permission.js';
import { AVAILABLE_PROFILES } from '../agent/profile.js';
import type { SessionClient } from '../client/contracts.js';
import type { AppRuntime } from '../layer.js';

// 本文件实际用到的会话存储面
type SessionStorePort = Pick<
  SessionShape,
  | 'create'
  | 'load'
  | 'deleteSession'
  | 'forkSession'
  | 'listSessions'
  | 'readUITurns'
  | 'setActiveProfile'
  | 'setPermissionMode'
>;

export function createDirectSessionClient(rt: AppRuntime): SessionClient {
  return {
    async createSession({ cwd, activeProfile, permissionMode, model }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          const state = yield* session.create(cwd, {
            model,
            activeProfile,
            permissionMode,
          });
          return { sessionId: state.sessionId };
        })
      );
    },

    async resumeSession({ sessionId, cwd }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          return yield* session.readUITurns(sessionId, cwd);
        })
      );
    },

    async listSessions({ cwd }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          return yield* session.listSessions(cwd);
        })
      );
    },

    async getSessionHistory({ sessionId, cwd }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          return yield* session.readUITurns(sessionId, cwd);
        })
      );
    },

    async deleteSession({ sessionId, cwd }) {
      await rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          yield* session.deleteSession(sessionId, cwd);
        })
      );
    },

    async getSessionProfile({ sessionId, cwd }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          return {
            activeProfile: state.activeProfile,
            permissionMode: state.permissionMode,
            cwd,
            available: AVAILABLE_PROFILES,
          };
        })
      );
    },

    async setSessionProfile({ sessionId, cwd, activeProfile }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          yield* session.setActiveProfile(cwd, sessionId, activeProfile);
          const state = yield* session.load(cwd, sessionId);
          return { activeProfile: state.activeProfile, permissionMode: state.permissionMode };
        })
      );
    },

    async getSessionPermissionMode({ sessionId, cwd }): Promise<PermissionMode> {
      const mode = await rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          return state.permissionMode;
        })
      );
      return mode as PermissionMode;
    },

    async setSessionPermissionMode({ sessionId, cwd, mode }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          yield* session.setPermissionMode(cwd, sessionId, mode);
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
      };
    },
    async rollbackContext() {
      return { turns: [] };
    },
    async rollbackBothToTurn() {
      return {
        turns: [],
        codeResult: {
          reverted: false,
          throughTurnId: 0,
          affectedTurns: [],
          selectedFiles: [],
        },
      };
    },
    async forkSession({ sessionId, cwd, atTurnId }) {
      const newSessionId = await rt.runPromise(
        Effect.gen(function* () {
          const session: SessionStorePort = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          return yield* session.forkSession(state, atTurnId ?? 0);
        })
      );
      return { sessionId: newSessionId, turns: [] };
    },
  };
}
