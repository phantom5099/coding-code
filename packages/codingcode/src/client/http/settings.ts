import type { PermissionMode } from '../../approval/types.js';
import type { McpServerConfig, McpStatus } from '../../mcp/types.js';
import type { AgentProfile } from '../../subagent/registry.js';
import type { UserHookConfig } from '../../hooks/config.js';
import type { createRequestHelpers } from './request.js';

export interface SettingsClient {
  getMemoryEnabled(): Promise<boolean>;
  getMemoryConfig(): Promise<{
    enabled: boolean;
    types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }>;
  }>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  setMemoryTypeDisabled(name: string, disabled: boolean): Promise<void>;
  addMemoryExtraType(type: { name: string; description: string }): Promise<void>;
  updateMemoryExtraType(name: string, type: { name: string; description: string }): Promise<void>;
  deleteMemoryExtraType(name: string): Promise<void>;
  getSubagentEnabled(query: { cwd: string }): Promise<{ enabled: boolean; source: string }>;
  setSubagentEnabled(body: { enabled: boolean; cwd: string }): Promise<void>;
  resetSubagentEnabled(body: { cwd: string }): Promise<void>;
  getMcpStatus(): Promise<McpStatus[]>;
  setMcpDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetMcpDisabled(body: { name: string; cwd: string }): Promise<void>;
  createMcpServer(input: { cwd: string; server: McpServerConfig }): Promise<void>;
  updateMcpServer(input: { cwd: string; name: string; server: McpServerConfig }): Promise<void>;
  deleteMcpServer(input: { cwd: string; name: string }): Promise<void>;
  listSkills(): Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  toggleSkill(body: { name: string; enabled: boolean; cwd: string }): Promise<void>;
  listAgents(input: { cwd: string }): Promise<any[]>;
  createAgent(input: { cwd: string; profile: AgentProfile }): Promise<void>;
  updateAgent(input: { cwd: string; name: string; profile: AgentProfile }): Promise<void>;
  deleteAgent(input: { cwd: string; name: string }): Promise<void>;
  setAgentDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetAgentDisabled(body: { name: string; cwd: string }): Promise<void>;
  listHooks(input: { cwd: string }): Promise<UserHookConfig[]>;
  createHook(input: { cwd: string; hook: UserHookConfig }): Promise<void>;
  updateHook(input: { cwd: string; name: string; hook: UserHookConfig }): Promise<void>;
  deleteHook(input: { cwd: string; name: string }): Promise<void>;
  setHookDisabled(input: { cwd: string; name: string; disabled: boolean }): Promise<void>;
  resetHookDisabled(body: { name: string; cwd: string }): Promise<void>;
  getGlobalPermissionMode(): Promise<PermissionMode>;
  setGlobalPermissionMode(mode: PermissionMode): Promise<void>;
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

    async getSubagentEnabled({ cwd }) {
      return apiGet<{ enabled: boolean; source: string }>(
        `/api/settings/subagent/enabled${qsCwd(cwd)}`
      );
    },

    async setSubagentEnabled({ enabled, cwd }) {
      await apiPost(`/api/settings/subagent/enabled${qsCwd(cwd)}`, { enabled });
    },

    async resetSubagentEnabled({ cwd }) {
      await apiPost(`/api/settings/subagent/enabled/reset${qsCwd(cwd)}`, {});
    },

    async getMcpStatus() {
      return apiGet<McpStatus[]>('/api/settings/mcp');
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

    async toggleSkill({ name, enabled, cwd }) {
      await apiPost(`/api/settings/skills${qsCwd(cwd)}`, { name, enabled });
    },

    async listAgents({ cwd }) {
      return apiGet(`/api/settings/agents${qsCwd(cwd)}`);
    },

    async createAgent({ cwd, profile }) {
      await apiPost(`/api/settings/agents${qsCwd(cwd)}`, profile);
    },

    async updateAgent({ cwd, name, profile }) {
      await apiPut(`/api/settings/agents/${encodeURIComponent(name)}${qsCwd(cwd)}`, profile);
    },

    async deleteAgent({ cwd, name }) {
      await apiDelete(`/api/settings/agents/${encodeURIComponent(name)}${qsCwd(cwd)}`);
    },

    async setAgentDisabled({ name, disabled, cwd }) {
      await apiPost(`/api/settings/agents/${encodeURIComponent(name)}/disabled${qsCwd(cwd)}`, {
        disabled,
      });
    },

    async resetAgentDisabled({ name, cwd }) {
      await apiPost(
        `/api/settings/agents/${encodeURIComponent(name)}/disabled/reset${qsCwd(cwd)}`,
        {}
      );
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

    async getGlobalPermissionMode() {
      const data = await apiGet<{ mode: PermissionMode }>('/api/agent/permission-mode');
      return data.mode;
    },

    async setGlobalPermissionMode(mode) {
      await apiPost('/api/agent/permission-mode', { mode });
    },
  };
}
