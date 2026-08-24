import type { PermissionMode } from '../../approval/types.js';
import type { McpServerConfig, McpStatus } from '../../mcp/types.js';
import type { UserHookConfig } from '../../hooks/types.js';
import type { createRequestHelpers } from './request.js';

export interface SettingsClient {
  getMemoryEnabled(): Promise<boolean>;
  getMemoryConfig(): Promise<{
    enabled: boolean;
    types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }>;
    model: string;
  }>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  setMemoryTypeDisabled(name: string, disabled: boolean): Promise<void>;
  addMemoryExtraType(type: { name: string; description: string }): Promise<void>;
  updateMemoryExtraType(name: string, type: { name: string; description: string }): Promise<void>;
  deleteMemoryExtraType(name: string): Promise<void>;
  setMemoryModel(model: string): Promise<{ model: string }>;
  getAgentConfig(): Promise<{ maxSteps: number; maxStopContinuations: number }>;
  setCompactionModel(compactionModel: string): Promise<{ compactionModel: string }>;
  getMcpStatus(input: { cwd: string }): Promise<McpStatus[]>;
  setMcpDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetMcpDisabled(body: { name: string; cwd: string }): Promise<void>;
  createMcpServer(input: { cwd: string; server: McpServerConfig }): Promise<void>;
  updateMcpServer(input: { cwd: string; name: string; server: McpServerConfig }): Promise<void>;
  deleteMcpServer(input: { cwd: string; name: string }): Promise<void>;
  listSkills(): Promise<Array<{ name: string; description: string; skillPath: string }>>;
  listHooks(input: { cwd: string }): Promise<UserHookConfig[]>;
  createHook(input: { cwd: string; hook: UserHookConfig }): Promise<void>;
  updateHook(input: { cwd: string; name: string; hook: UserHookConfig }): Promise<void>;
  deleteHook(input: { cwd: string; name: string }): Promise<void>;
  setHookDisabled(input: { cwd: string; name: string; disabled: boolean }): Promise<void>;
  resetHookDisabled(body: { name: string; cwd: string }): Promise<void>;
  getGlobalPermissionMode(input: { sessionId: string; cwd: string }): Promise<PermissionMode>;
  setGlobalPermissionMode(input: {
    sessionId: string;
    cwd: string;
    mode: PermissionMode;
  }): Promise<void>;
}

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

    async setCompactionModel(compactionModel) {
      return apiPost('/api/settings/context/compaction-model', { compactionModel });
    },

    async setMemoryEnabled(enabled) {
      await apiPost('/api/settings/memory/enabled', { enabled });
    },

    async setMemoryTypeDisabled(name, disabled) {
      await apiPost('/api/settings/memory/type-disabled', { name, disabled });
    },

    async addMemoryExtraType(type) {
      await apiPost('/api/settings/memory/extra-type', type);
    },

    async updateMemoryExtraType(name, type) {
      await apiPut(`/api/settings/memory/extra-type/${encodeURIComponent(name)}`, type);
    },

    async deleteMemoryExtraType(name) {
      await apiDelete(`/api/settings/memory/extra-type/${encodeURIComponent(name)}`);
    },

    async getMcpStatus({ cwd }) {
      return apiGet<McpStatus[]>(`/api/settings/mcp${qsCwd(cwd)}`);
    },

    async setMcpDisabled({ name, disabled, cwd }) {
      await apiPost(`/api/settings/mcp/${encodeURIComponent(name)}/disabled${qsCwd(cwd)}`, {
        disabled,
      });
    },

    async resetMcpDisabled({ name, cwd }) {
      await apiPost(
        `/api/settings/mcp/${encodeURIComponent(name)}/disabled/reset${qsCwd(cwd)}`,
        {}
      );
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

    async listSkills() {
      return apiGet('/api/settings/skills');
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

    async setHookDisabled({ cwd, name, disabled }) {
      await apiPost(`/api/settings/hooks/${encodeURIComponent(name)}/disabled${qsCwd(cwd)}`, {
        disabled,
      });
    },

    async resetHookDisabled({ name, cwd }) {
      await apiPost(
        `/api/settings/hooks/${encodeURIComponent(name)}/disabled/reset${qsCwd(cwd)}`,
        {}
      );
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
