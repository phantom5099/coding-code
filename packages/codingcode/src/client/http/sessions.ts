import type { PermissionMode } from '../../approval/types.js';
import type { SessionIndex } from '../../session/types.js';
import type { SessionClient } from '../contracts.js';
import type { createRequestHelpers } from './request.js';

export function createHttpSessionClient(
  request: ReturnType<typeof createRequestHelpers>
): SessionClient {
  const { apiGet, apiPost, apiPut, apiDelete } = request;

  return {
    async createSession({ cwd, activeProfile, permissionMode, model }) {
      return apiPost('/api/sessions', { cwd, activeProfile, permissionMode, model });
    },

    async resumeSession({ sessionId, cwd }) {
      return apiPost(`/api/sessions/${sessionId}/resume`, { cwd });
    },

    async listSessions({ cwd }) {
      const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
      return apiGet<SessionIndex[]>(`/api/sessions${qs}`);
    },

    async getSessionHistory({ sessionId, cwd }) {
      return apiGet(`/api/sessions/${sessionId}/history?cwd=${encodeURIComponent(cwd)}`);
    },

    async deleteSession({ sessionId, cwd }) {
      await apiDelete(`/api/sessions/${sessionId}?cwd=${encodeURIComponent(cwd)}`);
    },

    async getSessionProfile({ sessionId, cwd }) {
      return apiGet(`/api/sessions/${sessionId}/profile?cwd=${encodeURIComponent(cwd)}`);
    },

    async setSessionProfile({ sessionId, cwd, activeProfile }) {
      return apiPost(`/api/sessions/${sessionId}/profile`, { cwd, activeProfile });
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

    async getSessionPlan({ sessionId, cwd }) {
      return apiGet(`/api/sessions/${sessionId}/plan?cwd=${encodeURIComponent(cwd)}`);
    },

    async getCheckpointDiff({ sessionId, cwd, turnId }) {
      const segment = turnId != null ? String(turnId) : 'latest';
      return apiGet(
        `/api/sessions/${sessionId}/checkpoints/${segment}/diff?cwd=${encodeURIComponent(cwd)}`
      );
    },

    async revertCheckpointFiles({ sessionId, cwd, files }) {
      const res = await apiPost<{ ok: boolean; result: import('../../checkpoint/types.js').CodeRollbackResult }>(
        `/api/sessions/${sessionId}/checkpoints/latest/revert-files`,
        { cwd, files }
      );
      return res.result;
    },

    async previewRollbackDiff({ sessionId, cwd, throughTurnId }) {
      return apiGet(
        `/api/sessions/${sessionId}/rollback-preview?cwd=${encodeURIComponent(cwd)}&throughTurnId=${throughTurnId}`
      );
    },

    async rollbackCodeToTurn({ sessionId, cwd, throughTurnId }) {
      const res = await apiPost<{ ok: boolean; result: import('../../checkpoint/types.js').CodeRollbackResult }>(
        `/api/sessions/${sessionId}/rollback-code-to-turn`,
        { cwd, throughTurnId }
      );
      return res.result;
    },

    async rollbackContext({ sessionId, cwd, throughTurnId }) {
      return apiPost(`/api/sessions/${sessionId}/rollback-context`, { cwd, throughTurnId });
    },

    async rollbackBothToTurn({ sessionId, cwd, throughTurnId }) {
      return apiPost(`/api/sessions/${sessionId}/rollback-both-to-turn`, { cwd, throughTurnId });
    },

    async forkSession({ sessionId, cwd, atTurnId }) {
      return apiPost(`/api/sessions/${sessionId}/fork`, { cwd, atTurnId });
    },
  };
}

export type { SessionClient };
