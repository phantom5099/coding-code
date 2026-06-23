import type { PermissionMode } from '../../approval/types.js';
import type {
  CheckpointDiff,
  CodeRollbackResult,
  CodeRollbackUndoResult,
  RollbackPreviewDiff,
  RollbackState,
} from '../../checkpoint/types.js';
import type { SessionEvent, SessionIndex, SessionMode } from '../../session/types.js';
import type { createRequestHelpers } from './request.js';

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
  getSessionPermissionMode(input: { sessionId: string; cwd: string }): Promise<PermissionMode>;
  setSessionPermissionMode(input: {
    sessionId: string;
    cwd: string;
    mode: PermissionMode;
  }): Promise<void>;

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

export function createHttpSessionClient(
  request: ReturnType<typeof createRequestHelpers>
): SessionClient {
  const { apiGet, apiPost, apiPut, apiDelete } = request;

  return {
    async createSession({ cwd, mode, permissionMode, model }) {
      return apiPost('/api/sessions', { cwd, mode, permissionMode, model });
    },

    async resumeSession({ sessionId, cwd }) {
      return apiPost(`/api/sessions/${sessionId}/resume`, { cwd });
    },

    async listSessions({ cwd }) {
      const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
      return apiGet<SessionIndex[]>(`/api/sessions${qs}`);
    },

    async getSessionHistory({ sessionId, cwd }) {
      return apiGet<SessionEvent[]>(
        `/api/sessions/${sessionId}/history?cwd=${encodeURIComponent(cwd)}`
      );
    },

    async deleteSession({ sessionId, cwd }) {
      await apiDelete(`/api/sessions/${sessionId}?cwd=${encodeURIComponent(cwd)}`);
    },

    async getSessionPermissionMode({ sessionId, cwd }) {
      const data = await apiGet<{ mode: PermissionMode }>(
        `/api/sessions/${sessionId}/permission-mode?cwd=${encodeURIComponent(cwd)}`
      );
      return data.mode;
    },

    async setSessionPermissionMode({ sessionId, cwd, mode }) {
      await apiPut(`/api/sessions/${sessionId}/permission-mode`, { cwd, mode });
    },

    async getCheckpointDiff({ sessionId, cwd, turnId }) {
      const segment = turnId != null ? String(turnId) : 'latest';
      return apiGet(
        `/api/sessions/${sessionId}/checkpoints/${segment}/diff?cwd=${encodeURIComponent(cwd)}`
      );
    },

    async revertCheckpointFiles({ sessionId, cwd, files }) {
      return apiPost(`/api/sessions/${sessionId}/checkpoints/latest/revert-files`, { cwd, files });
    },

    async previewRollbackDiff({ sessionId, cwd, throughTurnId }) {
      return apiGet(
        `/api/sessions/${sessionId}/rollback-preview?cwd=${encodeURIComponent(cwd)}&throughTurnId=${throughTurnId}`
      );
    },

    async rollbackCodeToTurn({ sessionId, cwd, throughTurnId }) {
      return apiPost(`/api/sessions/${sessionId}/rollback-code-to-turn`, { cwd, throughTurnId });
    },

    async rollbackContext({ sessionId, cwd, throughTurnId }) {
      return apiPost(`/api/sessions/${sessionId}/rollback-context`, { cwd, throughTurnId });
    },

    async rollbackBothToTurn({ sessionId, cwd, throughTurnId }) {
      return apiPost(`/api/sessions/${sessionId}/rollback-both-to-turn`, { cwd, throughTurnId });
    },

    async undoLastCodeRollback({ sessionId, cwd, force, files }) {
      return apiPost(`/api/sessions/${sessionId}/undo-code-rollback`, { cwd, force, files });
    },

    async getRollbackState({ sessionId, cwd }) {
      return apiGet(`/api/sessions/${sessionId}/rollback-state?cwd=${encodeURIComponent(cwd)}`);
    },

    async forkSession({ sessionId, cwd, atTurnId }) {
      return apiPost(`/api/sessions/${sessionId}/fork`, { cwd, atTurnId });
    },
  };
}
