import type { McpServerEntry } from '../dto.js';
import type { PermissionMode } from '../types.js';
import type { SettingsClient } from '../contracts.js';
import type { createRequestHelpers } from './request.js';

export function createHttpSettingsClient(
  request: ReturnType<typeof createRequestHelpers>
): SettingsClient {
  const { apiGet, apiPost, apiPut, apiDelete } = request;

  function qsCwd(cwd: string): string {
    return `?cwd=${encodeURIComponent(cwd)}`;
  }

  return {
    async getMemoryEnabled() {
      const data = await apiGet<{ enabled: boolean }>('/api/settings/memory/config');
      return data.enabled;
    },

    async getMemoryConfig() {
      return apiGet('/api/settings/memory/config');
    },

    async setMemoryModel(model) {
      return apiPost('/api/settings/memory/model', { model });
    },

    async getAgentConfig() {
      return apiGet('/api/settings/agent/config');
    },

    async setAgentConfig(patch) {
      return apiPost('/api/settings/agent/config', patch);
    },

    async setCompactionModel(compactionModel) {
      return apiPost('/api/settings/context/compaction-model', { compactionModel });
    },

    async setMemoryEnabled(enabled) {
      await apiPost('/api/settings/memory/enabled', { enabled });
    },

    async getMcpStatus({ cwd }) {
      return apiGet<McpServerEntry[]>(`/api/settings/mcp${qsCwd(cwd)}`);
    },

    async setMcpEnabled({ name, enabled, cwd }) {
      await apiPost(`/api/settings/mcp/${encodeURIComponent(name)}/enabled${qsCwd(cwd)}`, {
        enabled,
      });
    },

    async createMcpServer({ cwd, server }) {
      await apiPost(`/api/settings/mcp${qsCwd(cwd)}`, server);
    },

    async updateMcpServer({ cwd, name, server }) {
      await apiPut(`/api/settings/mcp/${encodeURIComponent(name)}${qsCwd(cwd)}`, server);
    },

    async deleteMcpServer({ cwd, name }) {
      await apiDelete(`/api/settings/mcp/${encodeURIComponent(name)}${qsCwd(cwd)}`);
    },

    async listSkills({ cwd }) {
      return apiGet(`/api/settings/skills${qsCwd(cwd)}`);
    },

    async listHooks({ cwd }) {
      return apiGet(`/api/settings/hooks${qsCwd(cwd)}`);
    },

    async createHook({ cwd, hook }) {
      await apiPost(`/api/settings/hooks${qsCwd(cwd)}`, hook);
    },

    async updateHook({ cwd, name, hook }) {
      await apiPut(`/api/settings/hooks/${encodeURIComponent(name)}${qsCwd(cwd)}`, hook);
    },

    async deleteHook({ cwd, name }) {
      await apiDelete(`/api/settings/hooks/${encodeURIComponent(name)}${qsCwd(cwd)}`);
    },

    async setHookEnabled({ cwd, name, enabled }) {
      await apiPost(`/api/settings/hooks/${encodeURIComponent(name)}/enabled${qsCwd(cwd)}`, {
        enabled,
      });
    },

    async getGlobalPermissionMode(input: {
      sessionId: string;
      cwd: string;
    }): Promise<PermissionMode> {
      const data = await apiGet<{ mode: PermissionMode }>(
        `/api/sessions/${input.sessionId}/permission-mode?cwd=${encodeURIComponent(input.cwd)}`
      );
      return data.mode;
    },

    async setGlobalPermissionMode(input: {
      sessionId: string;
      cwd: string;
      mode: PermissionMode;
    }): Promise<void> {
      await apiPut(`/api/sessions/${input.sessionId}/permission-mode`, input);
    },
  };
}

export type { SettingsClient };
