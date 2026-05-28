import type { AgentClient, StreamChunk } from './direct.js';
import type { McpStatus } from '../mcp/types.js';
import type { PermissionMode } from '../approval/types.js';

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
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No body');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            switch (data.type) {
              case 'session_id':
                currentSessionId = data.sessionId;
                break;
              case 'text':
                yield data.text;
                break;
              case 'approval_request':
                yield { type: 'approval_request', id: data.id, tool: data.tool, args: data.args };
                break;
              case 'tool_start':
                yield { type: 'tool_start', name: data.name, args: data.args };
                break;
              case 'tool_result':
                yield { type: 'tool_result', id: data.id, name: data.name, output: data.output, ok: data.ok };
                break;
              case 'tool_denied':
                yield { type: 'tool_denied', name: data.name, reason: data.reason };
                break;
              case 'todo_update':
                yield { type: 'todo_update', items: data.items };
                break;
              case 'error':
                throw new Error(data.message);
              case 'done':
                break;
              case 'complete':
                return;
            }
          }
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
      return apiGet<McpStatus[]>('/api/agent/mcp');
    },

    async disableMcp(name: string) {
      await apiPost('/api/agent/mcp/disable', { name });
    },

    async enableMcp(name: string) {
      await apiPost('/api/agent/mcp/enable', { name });
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
