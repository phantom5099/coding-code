import type { AgentClient, StreamChunk } from './types.js';
import type { McpServerConfig } from '../mcp/types.js';
import type { AgentProfile } from '../subagent/types.js';
import type { UserHookConfig } from '../hooks/types.js';
import type { PermissionMode } from '../approval/types.js';
import type { SessionEvent } from '../session/types.js';
import type { RollbackState } from '../checkpoint/types.js';
import { parseSseStream } from './sse.js';
import { createHttpClients } from './http/index.js';

export async function createHttpClient(serverUrl: string): Promise<AgentClient> {
  let currentSessionId: string | undefined;
  const clients = createHttpClients(serverUrl);

  return {
    async *sendMessage(input: string, cwd?: string): AsyncGenerator<StreamChunk> {
      const response = await fetch(
        `${serverUrl}/api/sessions/${currentSessionId || '_'}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ input, cwd: cwd ?? '' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      for await (const data of parseSseStream(response)) {
        switch (data.type) {
          case 'session_id':
            currentSessionId = data.sessionId as string;
            yield { type: 'session_id', sessionId: data.sessionId as string };
            break;
          case 'turn_id':
            yield { type: 'turn_id', turnId: data.turnId as number };
            break;
          case 'text':
            yield {
              type: 'text',
              text: data.text as string,
              messageId: data.messageId as number | undefined,
            };
            break;
          case 'message':
            yield {
              type: 'message',
              id: data.id as number,
              content: data.content as string,
              partial: false,
            };
            break;
          case 'approval_request':
            yield {
              type: 'approval_request',
              id: data.id as string,
              tool: data.tool as string,
              args: data.args as Record<string, unknown>,
              payload: data.payload as Record<string, unknown> | undefined,
            };
            break;
          case 'tool_start':
            yield {
              type: 'tool_start',
              id: data.id as string,
              name: data.name as string,
              args: data.args as Record<string, unknown>,
            };
            break;
          case 'tool_result':
            yield {
              type: 'tool_result',
              id: data.id as string,
              name: data.name as string,
              output: data.output as string,
              ok: data.ok as boolean,
            };
            break;
          case 'tool_denied':
            yield {
              type: 'tool_denied',
              id: data.id as string,
              name: data.name as string,
              reason: data.reason as string,
            };
            break;
          case 'todo_update':
            yield { type: 'todo_update', items: data.items as any };
            break;
          case 'usage':
            yield {
              type: 'usage',
              prompt: data.prompt as number,
              completion: data.completion as number,
              total: data.total as number,
            };
            break;
          case 'error':
            yield { type: 'error', message: data.message as string, code: data.code as string };
            return;
          case 'done':
            break;
          case 'complete':
            return;
        }
      }
    },

    async sendApprovalResponse(id: string, response: string) {
      if (!currentSessionId) return;
      await clients.agent.sendApprovalResponse({
        sessionId: currentSessionId,
        approvalId: id,
        response,
      });
    },

    async sendPlanApprovalResponse(id: string, response: string) {
      if (!currentSessionId) return;
      await clients.agent.sendPlanApprovalResponse({
        sessionId: currentSessionId,
        approvalId: id,
        response,
      });
    },

    async resumeSession(sid: string) {
      currentSessionId = sid;
      return clients.sessions.resumeSession({ sessionId: sid, cwd: '' });
    },

    async listSessions() {
      return clients.sessions.listSessions({ cwd: '' });
    },

    async listModels() {
      return clients.models.listModels();
    },

    async switchModel(id: string) {
      await clients.models.switchModel({ id });
    },

    getSessionId() {
      return currentSessionId ?? 'unknown';
    },

    async getCheckpoints() {
      return [];
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
        restoreEntry: null,
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
        restoreEntry: null,
      };
    },
    async rollbackContext() {
      return {
        turns: [] as SessionEvent[],
        rollbackState: {
          context: { active: false, currentThroughTurnId: null },
          code: {
            canUndoLast: false,
            lastEntry: null,
            revertedFiles: [] as string[],
            lastEntryId: null,
          },
        } as RollbackState,
      };
    },
    async rollbackBothToTurn() {
      return {
        turns: [] as SessionEvent[],
        codeResult: {
          reverted: false,
          throughTurnId: 0,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        },
        rollbackState: {
          context: { active: false, currentThroughTurnId: null },
          code: {
            canUndoLast: false,
            lastEntry: null,
            revertedFiles: [] as string[],
            lastEntryId: null,
          },
        } as RollbackState,
      };
    },
    async undoLastCodeRollback() {
      return {
        restored: false,
        conflict: false,
        conflictFiles: [],
        restoredFiles: [],
        remainingRolledBack: [],
      };
    },
    async getRollbackState() {
      return {
        context: { active: false, currentThroughTurnId: null },
        code: { canUndoLast: false, lastEntry: null, revertedFiles: [], lastEntryId: null },
      };
    },
    async forkSession(_atTurnId?: number) {
      return '';
    },

    async compact() {
      if (!currentSessionId) return;
      await clients.agent.compact({ sessionId: currentSessionId, cwd: '' });
    },

    async getMemoryEnabled() {
      const data = await clients.settings.getMemoryConfig();
      return data.enabled;
    },

    async setMemoryEnabled(enabled: boolean) {
      await clients.settings.setMemoryEnabled(enabled);
    },

    async getMemoryConfig() {
      return clients.settings.getMemoryConfig();
    },

    async setTypeDisabled(name: string, disabled: boolean) {
      await clients.settings.setMemoryTypeDisabled(name, disabled);
    },

    async addExtraType(type: { name: string; description: string }) {
      await clients.settings.addMemoryExtraType(type);
    },

    async updateExtraType(name: string, type: { name: string; description: string }) {
      await clients.settings.updateMemoryExtraType(name, type);
    },

    async deleteExtraType(name: string) {
      await clients.settings.deleteMemoryExtraType(name);
    },

    async getSubagentEnabled({ cwd }: { cwd: string }) {
      return clients.settings.getSubagentEnabled({ cwd });
    },

    async setSubagentEnabled(body: { enabled: boolean; cwd: string }) {
      await clients.settings.setSubagentEnabled(body);
    },

    async resetSubagentEnabled(body: { cwd: string }) {
      await clients.settings.resetSubagentEnabled(body);
    },

    async getMcpStatus({ cwd }: { cwd: string }) {
      return clients.settings.getMcpStatus({ cwd });
    },

    async setMcpDisabled(body: { name: string; disabled: boolean; cwd: string }) {
      await clients.settings.setMcpDisabled(body);
    },

    async resetMcpDisabled(body: { name: string; cwd: string }) {
      await clients.settings.resetMcpDisabled(body);
    },

    async listSkills() {
      return clients.settings.listSkills();
    },

    async toggleSkill(body: { name: string; enabled: boolean; cwd: string }) {
      await clients.settings.toggleSkill(body);
    },

    async createMcpServer(server: McpServerConfig, { cwd }: { cwd: string }) {
      await clients.settings.createMcpServer({ cwd, server });
    },

    async updateMcpServer(name: string, server: McpServerConfig, { cwd }: { cwd: string }) {
      await clients.settings.updateMcpServer({ cwd, name, server });
    },

    async deleteMcpServer(name: string, { cwd }: { cwd: string }) {
      await clients.settings.deleteMcpServer({ cwd, name });
    },

    async listAgents({ cwd }: { cwd: string }) {
      return clients.settings.listAgents({ cwd });
    },

    async createAgent(profile: AgentProfile, { cwd }: { cwd: string }) {
      await clients.settings.createAgent({ cwd, profile });
    },

    async updateAgent(name: string, profile: AgentProfile, { cwd }: { cwd: string }) {
      await clients.settings.updateAgent({ cwd, name, profile });
    },

    async deleteAgent(name: string, { cwd }: { cwd: string }) {
      await clients.settings.deleteAgent({ cwd, name });
    },

    async setAgentDisabled(body: { name: string; disabled: boolean; cwd: string }) {
      await clients.settings.setAgentDisabled(body);
    },

    async resetAgentDisabled(body: { name: string; cwd: string }) {
      await clients.settings.resetAgentDisabled(body);
    },

    async listHooks({ cwd }: { cwd: string }) {
      return clients.settings.listHooks({ cwd });
    },

    async setHookDisabled(body: { name: string; disabled: boolean; cwd: string }) {
      await clients.settings.setHookDisabled(body);
    },

    async resetHookDisabled(body: { name: string; cwd: string }) {
      await clients.settings.resetHookDisabled(body);
    },

    async createHook(hook: UserHookConfig, { cwd }: { cwd: string }) {
      await clients.settings.createHook({ cwd, hook });
    },

    async updateHook(name: string, hook: UserHookConfig, { cwd }: { cwd: string }) {
      await clients.settings.updateHook({ cwd, name, hook });
    },

    async deleteHook(name: string, { cwd }: { cwd: string }) {
      await clients.settings.deleteHook({ cwd, name });
    },

    async getPermissionMode() {
      return clients.settings.getGlobalPermissionMode();
    },

    async setPermissionMode(mode: PermissionMode) {
      await clients.settings.setGlobalPermissionMode(mode);
    },
  };
}
