import { Effect } from 'effect';
import type { AgentEvent } from '../agent/agent.js';
import { sendMessage } from '../agent/agent.js';
import { AppLayer } from '../layer.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import { getLLMClient } from '../llm/factory.js';
import { getWorkspaceCwd } from '../core/workspace.js';
import { getGlobalPermissionMode, setGlobalPermissionMode } from '../approval/index.js';
import type { PermissionMode } from '../approval/types.js';
import type { StreamChunk, AgentClient } from './types.js';
import { createDirectClients } from './direct/index.js';

export type { StreamChunk, AgentClient } from './types.js';

export async function* agentEventToStreamChunk(
  source: AsyncGenerator<AgentEvent, any, unknown>
): AsyncGenerator<StreamChunk, void, unknown> {
  let currentStep = 0;
  for await (const event of source) {
    switch (event._tag) {
      case 'Step':
        currentStep = event.step;
        break;
      case 'TurnId':
        yield { type: 'turn_id', turnId: event.turnId };
        break;
      case 'LlmChunk':
        yield { type: 'text', text: event.text, messageId: currentStep };
        break;
      case 'Assistant':
        yield { type: 'message', id: currentStep, content: event.content, partial: false };
        break;
      case 'ToolStart':
        yield { type: 'tool_start', id: event.id, name: event.name, args: event.args };
        break;
      case 'ToolResult':
        yield {
          type: 'tool_result',
          id: event.id,
          name: event.name,
          output: event.output,
          ok: event.ok,
        };
        break;
      case 'ToolDenied':
        yield { type: 'tool_denied', id: event.id, name: event.name, reason: event.reason };
        break;
      case 'ApprovalRequest':
        yield { type: 'approval_request', id: event.id, tool: event.tool, args: event.args };
        break;
      case 'Error':
        yield { type: 'error', message: event.error.message ?? String(event.error) };
        break;
      case 'Done':
        yield { type: 'done' };
        break;
      case 'TodoUpdate':
        yield { type: 'todo_update', items: event.items as any };
        break;
      case 'Usage':
        yield {
          type: 'usage',
          prompt: event.prompt,
          completion: event.completion,
          total: event.total,
        };
        break;
      case 'ReactiveCompact':
        yield {
          type: 'reactive_compact',
          released: event.released,
          promptEstimate: event.promptEstimate,
        };
        break;
    }
  }
}

export async function createDirectClient(llm: any): Promise<AgentClient> {
  let currentSessionId = '';
  let activeLlm = llm;

  const runWithLayer = <T>(eff: any): Promise<T> =>
    Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));

  const clients = createDirectClients(activeLlm, runWithLayer);
  const cwd = () => getWorkspaceCwd();

  return {
    getSessionId() {
      return currentSessionId;
    },

    async *sendMessage(input: string): AsyncGenerator<StreamChunk> {
      const { registerEmitter, unregisterEmitter } = await import('../approval/async-confirm.js');
      const program = sendMessage(currentSessionId || undefined, input, cwd(), activeLlm);
      const { stream: agentGen, sessionId } = (await runWithLayer(program)) as any;
      currentSessionId = sessionId;

      let notify:
        | ((req: {
            type: 'approval_request';
            id: string;
            tool: string;
            args: Record<string, unknown>;
          }) => void)
        | null = null;
      registerEmitter(sessionId, (id, tool, args) => {
        notify?.({ type: 'approval_request', id, tool, args });
      });

      try {
        const gen = agentEventToStreamChunk(agentGen);
        let pending = gen.next();

        while (true) {
          const approvalPromise = new Promise<{
            type: 'approval_request';
            id: string;
            tool: string;
            args: Record<string, unknown>;
          }>((resolve) => {
            notify = resolve;
          });

          const winner = await Promise.race([
            pending.then((c): { tag: 'chunk'; value: IteratorResult<StreamChunk, void> } => ({
              tag: 'chunk',
              value: c,
            })),
            approvalPromise.then((req): { tag: 'approval'; value: typeof req } => ({
              tag: 'approval',
              value: req,
            })),
          ]);

          if (winner.tag === 'chunk') {
            notify = null;
            if (winner.value.done) break;
            yield winner.value.value;
            pending = gen.next();
          } else {
            yield winner.value;
          }
        }
      } finally {
        unregisterEmitter(sessionId);
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

    async resumeSession(sid: string) {
      currentSessionId = sid;
      return clients.sessions.resumeSession({ sessionId: sid, cwd: cwd() });
    },

    async listSessions() {
      return clients.sessions.listSessions({ cwd: cwd() });
    },

    async listModels() {
      return clients.models.listModels();
    },

    async switchModel(id: string) {
      await clients.models.switchModel({ id });
      const clientResult = await getLLMClient();
      if (!clientResult.ok) throw clientResult.error;
      activeLlm = clientResult.value;
    },

    async classifyLastCompletedChanges() {
      return null;
    },
    async revertLastCompleted(_mode: 'agent' | 'all') {},
    async revertCheckpoint(_turnId: number, _mode: 'agent' | 'all') {},
    async forwardLastRevert() {},
    async hasForwardStack() {
      return false;
    },

    async getCheckpoints() {
      if (!currentSessionId) return [];
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.getCheckpoints(cwd(), currentSessionId);
        })
      );
    },

    async getCheckpointDiff(turnId?: number) {
      if (!currentSessionId) return { turnId: 0, files: [] };
      return clients.sessions.getCheckpointDiff({
        sessionId: currentSessionId,
        cwd: cwd(),
        turnId,
      });
    },

    async revertCheckpointFile(turnId: number, file: string) {
      if (!currentSessionId)
        return {
          reverted: false,
          throughTurnId: turnId,
          baseTurnId: null,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        };
      return clients.sessions.revertCheckpointFile({
        sessionId: currentSessionId,
        cwd: cwd(),
        file,
      });
    },

    async revertCheckpointFiles(turnId: number, files: string[]) {
      if (!currentSessionId)
        return {
          reverted: false,
          throughTurnId: turnId,
          baseTurnId: null,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        };
      return clients.sessions.revertCheckpointFiles({
        sessionId: currentSessionId,
        cwd: cwd(),
        files,
      });
    },

    async revertCheckpointAgentFiles(turnId: number) {
      if (!currentSessionId)
        return {
          reverted: false,
          throughTurnId: turnId,
          baseTurnId: null,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        };
      return clients.sessions.revertCheckpointAgentFiles({
        sessionId: currentSessionId,
        cwd: cwd(),
      });
    },

    async revertCheckpointAllFiles(turnId: number) {
      if (!currentSessionId)
        return {
          reverted: false,
          throughTurnId: turnId,
          baseTurnId: null,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        };
      return clients.sessions.revertCheckpointAllFiles({ sessionId: currentSessionId, cwd: cwd() });
    },

    async previewRollbackDiff(throughTurnId: number) {
      if (!currentSessionId)
        return { throughTurnId, baseTurnId: null, affectedTurns: [], diff: '' };
      return clients.sessions.previewRollbackDiff({
        sessionId: currentSessionId,
        cwd: cwd(),
        throughTurnId,
      });
    },

    async rollbackCodeToTurn(throughTurnId: number) {
      if (!currentSessionId)
        return {
          reverted: false,
          throughTurnId,
          baseTurnId: null,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        };
      return clients.sessions.rollbackCodeToTurn({
        sessionId: currentSessionId,
        cwd: cwd(),
        throughTurnId,
      });
    },

    async rollbackContext(throughTurnId: number) {
      if (!currentSessionId) return { turns: [], rollbackState: {} };
      return clients.sessions.rollbackContext({
        sessionId: currentSessionId,
        cwd: cwd(),
        throughTurnId,
      });
    },

    async rollbackBothToTurn(throughTurnId: number) {
      if (!currentSessionId)
        return {
          turns: [],
          codeResult: {
            reverted: false,
            throughTurnId,
            baseTurnId: null,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          },
          rollbackState: {},
        };
      return clients.sessions.rollbackBothToTurn({
        sessionId: currentSessionId,
        cwd: cwd(),
        throughTurnId,
      });
    },

    async undoLastCodeRollback(force?: boolean, files?: string[]) {
      if (!currentSessionId)
        return {
          restored: false,
          conflict: false,
          conflictFiles: [],
          restoredFiles: [],
          remainingRolledBack: [],
        };
      return clients.sessions.undoLastCodeRollback({
        sessionId: currentSessionId,
        cwd: cwd(),
        force,
        files,
      });
    },

    async getRollbackState() {
      if (!currentSessionId)
        return {
          context: { active: false, currentThroughTurnId: null },
          code: { canUndoLast: false, lastEntry: null, revertedFiles: [], lastEntryId: null },
        };
      return clients.sessions.getRollbackState({ sessionId: currentSessionId, cwd: cwd() });
    },

    async forkSession(atUuid?: string) {
      if (!currentSessionId) return '';
      const result = await clients.sessions.forkSession({
        sessionId: currentSessionId,
        cwd: cwd(),
        atUuid,
      });
      return result.sessionId;
    },

    async compact() {
      if (!currentSessionId) return;
      await clients.agent.compact({ sessionId: currentSessionId, cwd: cwd() });
    },

    async getMemoryEnabled() {
      return clients.settings.getMemoryEnabled();
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

    async getSubagentEnabled() {
      return clients.settings.getSubagentEnabled();
    },

    async setSubagentEnabled(enabled: boolean) {
      await clients.settings.setSubagentEnabled(enabled);
    },

    async getMcpStatus() {
      return clients.settings.getMcpStatus();
    },

    async disableMcp(name: string) {
      await clients.settings.setMcpDisabled(name, true);
    },

    async enableMcp(name: string) {
      await clients.settings.setMcpDisabled(name, false);
    },

    async createMcpServer(server: any): Promise<void> {
      await clients.settings.createMcpServer({ cwd: cwd(), server });
    },

    async updateMcpServer(name: string, server: any): Promise<void> {
      await clients.settings.updateMcpServer({ cwd: cwd(), name, server });
    },

    async deleteMcpServer(name: string): Promise<void> {
      await clients.settings.deleteMcpServer({ cwd: cwd(), name });
    },

    async listSkills() {
      return clients.settings.listSkills();
    },

    async toggleSkill(name: string, enabled: boolean) {
      await clients.settings.toggleSkill(name, enabled);
    },

    async listAgents() {
      return clients.settings.listAgents({ cwd: cwd() });
    },

    async createAgent(profile: any): Promise<void> {
      await clients.settings.createAgent({ cwd: cwd(), profile });
    },

    async updateAgent(name: string, profile: any): Promise<void> {
      await clients.settings.updateAgent({ cwd: cwd(), name, profile });
    },

    async deleteAgent(name: string): Promise<void> {
      await clients.settings.deleteAgent({ cwd: cwd(), name });
    },

    async setAgentDisabled(name: string, disabled: boolean): Promise<void> {
      await clients.settings.setAgentDisabled(name, disabled);
    },

    async listHooks() {
      return clients.settings.listHooks({ cwd: cwd() });
    },

    async setHookDisabled(name: string, disabled: boolean): Promise<void> {
      await clients.settings.setHookDisabled({ cwd: cwd(), name, disabled });
    },

    async createHook(hook: any): Promise<void> {
      await clients.settings.createHook({ cwd: cwd(), hook });
    },

    async updateHook(name: string, hook: any): Promise<void> {
      await clients.settings.updateHook({ cwd: cwd(), name, hook });
    },

    async deleteHook(name: string): Promise<void> {
      await clients.settings.deleteHook({ cwd: cwd(), name });
    },

    async getPermissionMode(): Promise<PermissionMode> {
      return getGlobalPermissionMode();
    },

    async setPermissionMode(mode: PermissionMode): Promise<void> {
      setGlobalPermissionMode(mode);
    },
  };
}
