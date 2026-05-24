import type { AgentClient, StreamChunk } from './direct.js';
import type { McpStatus } from '../mcp/types.js';
import { getWorkspaceCwd } from '../core/workspace.js';

export type { AgentClient, StreamChunk };

export async function createHttpClient(serverUrl: string): Promise<AgentClient> {
  let currentSessionId: string | undefined;

  return {
    async *sendMessage(input: string): AsyncGenerator<StreamChunk> {
      const response = await fetch(`${serverUrl}/api/sessions/${currentSessionId || '_'}/messages`, {
        method: 'POST', body: JSON.stringify({ input }),
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
            if (data.type === 'session_id') {
              currentSessionId = data.sessionId;
            } else if (data.type === 'text') {
              yield data.text;
            } else if (data.type === 'approval_request') {
              yield { type: 'approval_request', id: data.id, tool: data.tool, args: data.args };
            } else if (data.type === 'complete') {
              return;
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          }
        }
      }
    },

    async sendApprovalResponse(id: string, response: string) {
      if (!currentSessionId) return;
      await fetch(`${serverUrl}/api/sessions/${currentSessionId}/approval/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
    },

    async resumeSession(sid: string) {
      currentSessionId = sid;
      const res = await fetch(`${serverUrl}/api/sessions/${sid}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: getWorkspaceCwd() }) });
      return res.json();
    },
    async listSessions(): Promise<any[]> {
      const cwd = encodeURIComponent(getWorkspaceCwd());
      const res = await fetch(`${serverUrl}/api/sessions?cwd=${cwd}`);
      return res.json() as Promise<any[]>;
    },
    async listModels() { const res = await fetch(`${serverUrl}/api/models`); return res.json(); },
    async switchModel(id: string) { await fetch(`${serverUrl}/api/models/switch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: id }) }); },
    getSessionId() { return currentSessionId ?? 'unknown'; },
    async classifyLastCompletedChanges() { return null; },
    async revertLastCompleted(_mode: 'agent' | 'all') {},
    async revertCheckpoint(_turnId: number, _mode: 'agent' | 'all') {},
    async forwardLastRevert() {},
    async hasForwardStack() { return false; },
    async getCheckpoints() { return []; },

    async compact() {
      if (!currentSessionId) return;
      await fetch(`${serverUrl}/api/sessions/${currentSessionId}/compact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: getWorkspaceCwd() }),
      });
    },

    async getMemoryEnabled() {
      const res = await fetch(`${serverUrl}/api/agent/memory`);
      const data = await res.json() as { enabled: boolean };
      return data.enabled;
    },

    async setMemoryEnabled(enabled: boolean) {
      await fetch(`${serverUrl}/api/agent/memory`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      });
    },

    async getSubagentEnabled() {
      const res = await fetch(`${serverUrl}/api/agent/subagent`);
      const data = await res.json() as { enabled: boolean };
      return data.enabled;
    },

    async setSubagentEnabled(enabled: boolean) {
      await fetch(`${serverUrl}/api/agent/subagent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      });
    },

    async getMcpStatus(): Promise<McpStatus[]> {
      const res = await fetch(`${serverUrl}/api/agent/mcp`);
      return res.json() as Promise<McpStatus[]>;
    },

    async disableMcp(name: string) {
      await fetch(`${serverUrl}/api/agent/mcp/disable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
    },

    async enableMcp(name: string) {
      await fetch(`${serverUrl}/api/agent/mcp/enable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
    },

    async listSkills(): Promise<Array<{ name: string; description: string; enabled: boolean }>> {
      const res = await fetch(`${serverUrl}/api/agent/skills`);
      return res.json() as Promise<Array<{ name: string; description: string; enabled: boolean }>>;
    },

    async toggleSkill(name: string, enabled: boolean) {
      await fetch(`${serverUrl}/api/agent/skills`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, enabled }),
      });
    },
  };
}
