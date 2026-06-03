import type { PermissionMode } from '../../approval/types.js';
import type { createRequestHelpers } from './request.js';

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

  getCheckpointDiff(input: {
    sessionId: string;
    cwd: string;
    turnId?: number;
  }): Promise<{ turnId: number; files: any[] }>;
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

export function createHttpSessionClient(
  request: ReturnType<typeof createRequestHelpers>
): SessionClient {
  const { apiGet, apiPost, apiPut, apiDelete } = request;

  return {
    async createSession({ cwd, initialPermissionMode }) {
      return apiPost('/api/sessions', { cwd, initialPermissionMode });
    },

    async resumeSession({ sessionId, cwd }) {
      return apiPost(`/api/sessions/${sessionId}/resume`, { cwd });
    },

    async listSessions({ cwd }) {
      const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
      return apiGet<any[]>(`/api/sessions${qs}`);
    },

    async getSessionHistory({ sessionId }) {
      return apiGet<any[]>(`/api/sessions/${sessionId}/history`);
    },

    async deleteSession({ sessionId }) {
      await apiDelete(`/api/sessions/${sessionId}`);
    },

    async getSessionPermissionMode({ sessionId }) {
      const data = await apiGet<{ mode: PermissionMode }>(
        `/api/sessions/${sessionId}/permission-mode`
      );
      return data.mode;
    },

    async setSessionPermissionMode({ sessionId, mode }) {
      await apiPut(`/api/sessions/${sessionId}/permission-mode`, { mode });
    },

    async getCheckpointDiff({ sessionId, cwd, turnId }) {
      const segment = turnId != null ? String(turnId) : 'latest';
      return apiGet(
        `/api/sessions/${sessionId}/checkpoints/${segment}/diff?cwd=${encodeURIComponent(cwd)}`
      );
    },

    async revertCheckpointFile({ sessionId, cwd, file }) {
      return apiPost(`/api/sessions/${sessionId}/checkpoints/latest/revert-file`, { cwd, file });
    },

    async revertCheckpointFiles({ sessionId, cwd, files }) {
      return apiPost(`/api/sessions/${sessionId}/checkpoints/latest/revert-files`, { cwd, files });
    },

    async revertCheckpointAgentFiles({ sessionId, cwd }) {
      return apiPost(`/api/sessions/${sessionId}/checkpoints/latest/revert-agent`, { cwd });
    },

    async revertCheckpointAllFiles({ sessionId, cwd }) {
      return apiPost(`/api/sessions/${sessionId}/checkpoints/latest/revert-all`, { cwd });
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

    async forkSession({ sessionId, cwd, atUuid }) {
      return apiPost(`/api/sessions/${sessionId}/fork`, { cwd, atUuid });
    },
  };
}
