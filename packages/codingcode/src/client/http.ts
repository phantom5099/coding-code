import type { AgentClient, StreamChunk } from './direct.js';
import type { McpStatus } from '../mcp/types.js';
import type { PermissionMode } from '../approval/types.js';
import { parseSseStream } from './sse.js';

export type { AgentClient, StreamChunk };

export async function createHttpClient(serverUrl: string): Promise<AgentClient> {
  let currentSessionId: string | undefined;

  async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${serverUrl}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  }

  async function apiPost<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  }

  async function apiPut<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${serverUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  }

  async function apiDelete(path: string): Promise<void> {
    const res = await fetch(`${serverUrl}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  }

  return {
    async *sendMessage(input: string, cwd?: string): AsyncGenerator<StreamChunk> {
      const response = await fetch(`${serverUrl}/api/sessions/${currentSessionId || '_'}/messages`, {
        method: 'POST',
        body: JSON.stringify({ input, cwd: cwd ?? '' }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      for await (const data of parseSseStream(response)) {
        switch (data.type) {
          case 'session_id':
            currentSessionId = data.sessionId as string;
            break;
          case 'text':
            yield data.text as string;
            break;
          case 'approval_request':
            yield { type: 'approval_request', id: data.id as string, tool: data.tool as string, args: data.args as Record<string, unknown> };
            break;
          case 'tool_start':
            yield { type: 'tool_start', id: data.id as string, name: data.name as string, args: data.args as Record<string, unknown> };
            break;
          case 'tool_result':
            yield { type: 'tool_result', id: data.id as string, name: data.name as string, output: data.output as string, ok: data.ok as boolean };
            break;
          case 'tool_denied':
            yield { type: 'tool_denied', id: data.id as string, name: data.name as string, reason: data.reason as string };
            break;
          case 'todo_update':
            yield { type: 'todo_update', items: data.items as any };
            break;
          case 'error':
            throw new Error(data.message as string);
          case 'done':
            break;
          case 'complete':
            return;
        }
      }
    },

    async sendApprovalResponse(id: string, response: string) {
      if (!currentSessionId) return;
      await apiPost(`/api/sessions/${currentSessionId}/approval/${id}`, { response });
    },

    async resumeSession(sid: string) {
      currentSessionId = sid;
      return apiPost(`/api/sessions/${sid}/resume`, { cwd: '' });
    },

    async listSessions() {
      return apiGet<any[]>('/api/sessions');
    },

    async listModels() {
      return apiGet('/api/models');
    },

    async switchModel(id: string) {
      await apiPost('/api/models/switch', { modelId: id });
    },

    getSessionId() { return currentSessionId ?? 'unknown'; },

    async classifyLastCompletedChanges() { return null; },
    async revertLastCompleted(_mode: 'agent' | 'all') {},
    async revertCheckpoint(_turnId: number, _mode: 'agent' | 'all') {},
    async forwardLastRevert() {},
    async hasForwardStack() { return false; },
    async getCheckpoints() { return []; },

    async compact() {
      if (!currentSessionId) return;
      await apiPost(`/api/sessions/${currentSessionId}/compact`, { cwd: '' });
    },

    async getMemoryEnabled() {
      const data = await apiGet<{ enabled: boolean }>('/api/settings/memory/config');
      return data.enabled;
    },

    async setMemoryEnabled(enabled: boolean) {
      await apiPost('/api/settings/memory/enabled', { enabled });
    },

    async getMemoryConfig() {
      return apiGet<{ enabled: boolean; types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }> }>('/api/settings/memory/config');
    },

    async setTypeDisabled(name: string, disabled: boolean) {
      await apiPost('/api/settings/memory/type-disabled', { name, disabled });
    },

    async addExtraType(type: { name: string; description: string }) {
      await apiPost('/api/settings/memory/extra-type', type);
    },

    async updateExtraType(name: string, type: { name: string; description: string }) {
      await apiPut(`/api/settings/memory/extra-type/${encodeURIComponent(name)}`, type);
    },

    async deleteExtraType(name: string) {
      await apiDelete(`/api/settings/memory/extra-type/${encodeURIComponent(name)}`);
    },

    async getSubagentEnabled() {
      const data = await apiGet<{ enabled: boolean }>('/api/settings/subagent/enabled');
      return data.enabled;
    },

    async setSubagentEnabled(enabled: boolean) {
      await apiPost('/api/settings/subagent/enabled', { enabled });
    },

    async getMcpStatus(): Promise<McpStatus[]> {
      return apiGet<McpStatus[]>('/api/settings/mcp');
    },

    async disableMcp(name: string) {
      await apiPost(`/api/settings/mcp/${encodeURIComponent(name)}/disabled`, { disabled: true });
    },

    async enableMcp(name: string) {
      await apiPost(`/api/settings/mcp/${encodeURIComponent(name)}/disabled`, { disabled: false });
    },

    async listSkills() {
      return apiGet<Array<{ name: string; description: string; enabled: boolean }>>('/api/settings/skills');
    },

    async toggleSkill(name: string, enabled: boolean) {
      await apiPost('/api/settings/skills', { name, enabled });
    },

    async createMcpServer(server: any) {
      await apiPost('/api/settings/mcp', server);
    },

    async updateMcpServer(name: string, server: any) {
      await apiPut(`/api/settings/mcp/${encodeURIComponent(name)}`, server);
    },

    async deleteMcpServer(name: string) {
      await apiDelete(`/api/settings/mcp/${encodeURIComponent(name)}`);
    },

    async listAgents() {
      return apiGet<Array<any>>('/api/settings/agents');
    },

    async createAgent(profile: any) {
      await apiPost('/api/settings/agents', profile);
    },

    async updateAgent(name: string, profile: any) {
      await apiPut(`/api/settings/agents/${encodeURIComponent(name)}`, profile);
    },

    async deleteAgent(name: string) {
      await apiDelete(`/api/settings/agents/${encodeURIComponent(name)}`);
    },

    async setAgentDisabled(name: string, disabled: boolean) {
      await apiPost(`/api/settings/agents/${encodeURIComponent(name)}/disabled`, { disabled });
    },

    async listHooks() {
      return apiGet<Array<any>>('/api/settings/hooks');
    },

    async setHookDisabled(name: string, disabled: boolean) {
      await apiPost(`/api/settings/hooks/${encodeURIComponent(name)}/disabled`, { disabled });
    },

    async createHook(hook: any) {
      await apiPost('/api/settings/hooks', hook);
    },

    async updateHook(name: string, hook: any) {
      await apiPut(`/api/settings/hooks/${encodeURIComponent(name)}`, hook);
    },

    async deleteHook(name: string) {
      await apiDelete(`/api/settings/hooks/${encodeURIComponent(name)}`);
    },

    async getPermissionMode(): Promise<PermissionMode> {
      const data = await apiGet<{ mode: PermissionMode }>('/api/agent/permission-mode');
      return data.mode;
    },

    async setPermissionMode(mode: PermissionMode): Promise<void> {
      await apiPost('/api/agent/permission-mode', { mode });
    },
  };
}
