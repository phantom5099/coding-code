import { Effect } from 'effect';
import type { AgentEvent } from '../agent/agent.js';
import { sendMessage } from '../agent/agent.js';
import { SessionService } from '../session/store.js';
import { ContextService } from '../context/context.js';
import { ApprovalWaitService } from '../approval/async-confirm.js';
import { parseApprovalResponse } from '../approval/response.js';
import { AppLayer } from '../layer.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import type { CheckpointDiff, CodeRollbackResult, CodeRollbackUndoResult, RollbackPreviewDiff } from '../checkpoint/checkpoint-service.js';
import { getActiveEntry, getLLMClient, listModels, switchModel as switchActiveModel } from '../llm/factory.js';
import { getWorkspaceCwd } from '../core/workspace.js';
import { getSubagentEnabledState, setSubagentEnabledState } from '../subagent/registry.js';
import type { SubagentProfile } from '../subagent/registry.js';
import { McpService } from '../mcp/index.js';
import type { McpServerConfig, McpStatus } from '../mcp/types.js';
import { SkillService } from '../skills/index.js';
import { getMemoryEnabled, setMemoryEnabled } from '../memory/index.js';
import type { UserHookConfig } from '../hooks/config.js';
import { getGlobalPermissionMode, setGlobalPermissionMode } from '../approval/index.js';
import type { PermissionMode } from '../approval/types.js';
import * as settingsService from '../settings/service.js';

export type StreamChunk = string
  | { type: 'approval_request'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; output: string; ok: boolean }
  | { type: 'tool_denied'; id: string; name: string; reason: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'todo_update'; items: ReadonlyArray<{ step: string; status: string }> };

export interface AgentClient {
  sendMessage(input: string, cwd?: string): AsyncGenerator<StreamChunk>;
  sendApprovalResponse(id: string, response: string): Promise<void>;
  resumeSession(sid: string): Promise<any>;
  listSessions(): Promise<any[]>;
  listModels(): Promise<any>;
  switchModel(id: string): Promise<void>;
  getSessionId(): string;
  getCheckpoints(): Promise<Array<{ turnId: number; title: string; agentModified: string[]; unknownSource: string[] }>>;
  // New rollback methods
  getCheckpointDiff(turnId?: number): Promise<CheckpointDiff>;
  revertCheckpointFile(turnId: number, file: string): Promise<CodeRollbackResult>;
  revertCheckpointFiles(turnId: number, files: string[]): Promise<CodeRollbackResult>;
  revertCheckpointAgentFiles(turnId: number): Promise<CodeRollbackResult>;
  revertCheckpointAllFiles(turnId: number): Promise<CodeRollbackResult>;
  previewRollbackDiff(throughTurnId: number): Promise<RollbackPreviewDiff>;
  rollbackCodeToTurn(throughTurnId: number): Promise<CodeRollbackResult>;
  rollbackContext(throughTurnId: number): Promise<{ turns: any[]; rollbackState: any }>;
  rollbackBothToTurn(throughTurnId: number): Promise<{ turns: any[]; codeResult: CodeRollbackResult; rollbackState: any }>;
  undoLastCodeRollback(force?: boolean, files?: string[]): Promise<CodeRollbackUndoResult>;
  getRollbackState(): Promise<any>;
  forkSession(atUuid?: string): Promise<string>;
  // Existing non-rollback methods
  compact(): Promise<void>;
  getMemoryEnabled(): Promise<boolean>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  getMemoryConfig(): Promise<{ enabled: boolean; types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }> }>;
  setTypeDisabled(name: string, disabled: boolean): Promise<void>;
  addExtraType(type: { name: string; description: string }): Promise<void>;
  updateExtraType(name: string, type: { name: string; description: string }): Promise<void>;
  deleteExtraType(name: string): Promise<void>;
  getSubagentEnabled(): Promise<boolean>;
  setSubagentEnabled(enabled: boolean): Promise<void>;
  getMcpStatus(): Promise<McpStatus[]>;
  createMcpServer(server: McpServerConfig): Promise<void>;
  updateMcpServer(name: string, server: McpServerConfig): Promise<void>;
  deleteMcpServer(name: string): Promise<void>;
  disableMcp(name: string): Promise<void>;
  enableMcp(name: string): Promise<void>;
  listSkills(): Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  toggleSkill(name: string, enabled: boolean): Promise<void>;
  listAgents(): Promise<Array<{ name: string; description: string; tools?: string[]; mcpServers?: string[]; readonly?: boolean; maxSteps?: number; model?: string; disabled?: boolean }>>;
  createAgent(profile: SubagentProfile): Promise<void>;
  updateAgent(name: string, profile: SubagentProfile): Promise<void>;
  deleteAgent(name: string): Promise<void>;
  setAgentDisabled(name: string, disabled: boolean): Promise<void>;
  listHooks(): Promise<UserHookConfig[]>;
  setHookDisabled(name: string, disabled: boolean): Promise<void>;
  createHook(hook: UserHookConfig): Promise<void>;
  updateHook(name: string, hook: UserHookConfig): Promise<void>;
  deleteHook(name: string): Promise<void>;
  getPermissionMode(): Promise<PermissionMode>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
}

export async function* agentEventToStreamChunk(
  source: AsyncGenerator<AgentEvent, any, unknown>,
): AsyncGenerator<StreamChunk, void, unknown> {
  for await (const event of source) {
    switch (event._tag) {
      case 'LlmChunk':
        yield event.text;
        break;
      case 'ToolStart':
        yield { type: 'tool_start', id: event.id, name: event.name, args: event.args };
        break;
      case 'ToolResult':
        yield { type: 'tool_result', id: event.id, name: event.name, output: event.output, ok: event.ok };
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
    }
  }
}

export async function createDirectClient(llm: any): Promise<AgentClient> {
  let currentSessionId = '';
  let activeLlm = llm;

  const runWithLayer = <T,>(eff: any): Promise<T> =>
    Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));

  return {
    getSessionId() {
      return currentSessionId;
    },

    async *sendMessage(input: string): AsyncGenerator<StreamChunk> {
      const { registerEmitter, unregisterEmitter } = await import('../approval/async-confirm.js');
      const program = sendMessage(currentSessionId || undefined, input, getWorkspaceCwd(), activeLlm);
      const { stream: agentGen, sessionId } = await runWithLayer(program) as any;
      currentSessionId = sessionId;

      let notify: ((req: { type: 'approval_request'; id: string; tool: string; args: Record<string, unknown> }) => void) | null = null;
      registerEmitter(sessionId, (id, tool, args) => {
        notify?.({ type: 'approval_request', id, tool, args });
      });

      try {
        const gen = agentEventToStreamChunk(agentGen);
        let pending = gen.next();

        while (true) {
          const approvalPromise = new Promise<{ type: 'approval_request'; id: string; tool: string; args: Record<string, unknown> }>((resolve) => {
            notify = resolve;
          });

          const winner = await Promise.race([
            pending.then((c): { tag: 'chunk'; value: IteratorResult<StreamChunk, void> } => ({ tag: 'chunk', value: c })),
            approvalPromise.then((req): { tag: 'approval'; value: typeof req } => ({ tag: 'approval', value: req })),
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
      const result = parseApprovalResponse(response);
      await runWithLayer(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          return yield* svc.resolveConfirm(id, currentSessionId, result);
        }),
      );
    },

    async resumeSession(sid: string) {
      currentSessionId = sid;
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(getWorkspaceCwd(), 'unknown', '0.1.0', sid);
          return yield* svc.readHistory(state);
        }),
      );
    },

    async listSessions() {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.listSessions(getWorkspaceCwd());
        }),
      );
    },

    async listModels() {
      const modelsResult = listModels();
      if (!modelsResult.ok) throw modelsResult.error;
      const activeResult = getActiveEntry();
      return { models: modelsResult.value, activeId: activeResult.ok ? activeResult.value.id : null };
    },

    async switchModel(id: string) {
      const switchResult = switchActiveModel(id);
      if (!switchResult.ok) throw switchResult.error;
      const clientResult = await getLLMClient();
      if (!clientResult.ok) throw clientResult.error;
      activeLlm = clientResult.value;
    },

    async getCheckpoints() {
      if (!currentSessionId) return [];
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.getCheckpoints(getWorkspaceCwd(), currentSessionId);
        }),
      );
    },

    // ---- New rollback methods ----

    async getCheckpointDiff(turnId?: number) {
      if (!currentSessionId) return { turnId: 0, files: [] };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.getCheckpointDiff(getWorkspaceCwd(), currentSessionId, turnId);
        }),
      );
    },

    async revertCheckpointFile(turnId: number, file: string) {
      if (!currentSessionId) return { reverted: false, throughTurnId: turnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.revertCheckpointFile(getWorkspaceCwd(), currentSessionId, turnId, file);
        }),
      );
    },

    async revertCheckpointFiles(turnId: number, files: string[]) {
      if (!currentSessionId) return { reverted: false, throughTurnId: turnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.revertCheckpointFiles(getWorkspaceCwd(), currentSessionId, turnId, files);
        }),
      );
    },

    async revertCheckpointAgentFiles(turnId: number) {
      if (!currentSessionId) return { reverted: false, throughTurnId: turnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.revertCheckpointAgentFiles(getWorkspaceCwd(), currentSessionId, turnId);
        }),
      );
    },

    async revertCheckpointAllFiles(turnId: number) {
      if (!currentSessionId) return { reverted: false, throughTurnId: turnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.revertCheckpointAllFiles(getWorkspaceCwd(), currentSessionId, turnId);
        }),
      );
    },

    async previewRollbackDiff(throughTurnId: number) {
      if (!currentSessionId) return { throughTurnId, baseTurnId: null, affectedTurns: [], diff: '' };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.previewRollbackDiff(getWorkspaceCwd(), currentSessionId, throughTurnId);
        }),
      );
    },

    async rollbackCodeToTurn(throughTurnId: number) {
      if (!currentSessionId) return { reverted: false, throughTurnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.rollbackCodeToTurn(getWorkspaceCwd(), currentSessionId, throughTurnId);
        }),
      );
    },

    async rollbackContext(throughTurnId: number) {
      if (!currentSessionId) return { turns: [], rollbackState: {} };
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(getWorkspaceCwd(), 'unknown', '0.1.0', currentSessionId);
          yield* svc.rollbackToTurn(state, throughTurnId, 'user rollback to turn');
          return yield* svc.readHistory(state);
        }),
      );
    },

    async rollbackBothToTurn(throughTurnId: number) {
      if (!currentSessionId) return { turns: [], codeResult: { reverted: false, throughTurnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null }, rollbackState: {} };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          const svc = yield* SessionService;
          const codeResult = checkpoint.rollbackCodeToTurn(getWorkspaceCwd(), currentSessionId, throughTurnId);
          const state = yield* svc.create(getWorkspaceCwd(), 'unknown', '0.1.0', currentSessionId);
          yield* svc.rollbackToTurn(state, throughTurnId, 'user rollback to turn');
          const turns = yield* svc.readHistory(state);
          return { turns, codeResult, rollbackState: {} };
        }),
      );
    },

    async undoLastCodeRollback(force?: boolean, files?: string[]) {
      if (!currentSessionId) return { restored: false, conflict: false, conflictFiles: [], restoredFiles: [], remainingRolledBack: [] };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.undoLastCodeRollback(getWorkspaceCwd(), currentSessionId, { force, files });
        }),
      );
    },

    async getRollbackState() {
      if (!currentSessionId) return { context: { active: false, currentThroughTurnId: null }, code: { canUndoLast: false, lastEntry: null, revertedFiles: [], lastEntryId: null } };
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          const entry = checkpoint.getLatestRestoreEntry(getWorkspaceCwd(), currentSessionId);
          return {
            context: { active: false, currentThroughTurnId: null },
            code: {
              canUndoLast: entry !== null,
              lastEntry: entry,
              revertedFiles: entry?.selectedFiles ?? [],
              lastEntryId: entry?.id ?? null,
            },
          };
        }),
      );
    },

    async forkSession(atUuid?: string) {
      if (!currentSessionId) return '';
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(getWorkspaceCwd(), 'unknown', '0.1.0', currentSessionId);
          return yield* svc.forkSession(state, atUuid ?? '');
        }),
      );
    },

    // ---- Existing non-rollback methods ----

    async compact() {
      if (!currentSessionId) return;
      await runWithLayer(
        Effect.gen(function* () {
          const ctx = yield* ContextService;
          return yield* ctx.compress(currentSessionId, getWorkspaceCwd(), null);
        }),
      );
    },

    async getMemoryEnabled() {
      return getMemoryEnabled();
    },

    async setMemoryEnabled(enabled: boolean) {
      setMemoryEnabled(enabled);
    },

    async getMemoryConfig() {
      const { getAllTypesWithStatus, getMemoryConfig } = await import('../memory/config.js');
      const cfg = getMemoryConfig();
      return { enabled: cfg.enabled, types: getAllTypesWithStatus() };
    },

    async setTypeDisabled(name: string, disabled: boolean) {
      const { setMemoryTypeDisabled } = await import('../memory/config.js');
      setMemoryTypeDisabled(name, disabled);
    },

    async addExtraType(type: { name: string; description: string }) {
      const { addMemoryExtraType } = await import('../memory/config.js');
      addMemoryExtraType({ name: type.name, description: type.description, enabled: true });
    },

    async updateExtraType(name: string, type: { name: string; description: string }) {
      const { updateMemoryExtraType } = await import('../memory/config.js');
      updateMemoryExtraType(name, { name: type.name, description: type.description, enabled: true });
    },

    async deleteExtraType(name: string) {
      const { deleteMemoryExtraType } = await import('../memory/config.js');
      deleteMemoryExtraType(name);
    },

    async getSubagentEnabled() {
      return getSubagentEnabledState();
    },

    async setSubagentEnabled(enabled: boolean) {
      setSubagentEnabledState(enabled);
    },

    async getMcpStatus() {
      return runWithLayer(
        Effect.gen(function* () {
          const mcp = yield* McpService;
          return yield* mcp.status();
        }),
      );
    },

    async disableMcp(name: string) {
      await runWithLayer(
        Effect.gen(function* () {
          const mcp = yield* McpService;
          return yield* mcp.disable(name);
        }),
      );
    },

    async enableMcp(name: string) {
      await runWithLayer(
        Effect.gen(function* () {
          const mcp = yield* McpService;
          return yield* mcp.enable(name);
        }),
      );
    },

    async createMcpServer(server: McpServerConfig): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.createMcpServer(cwd, server);
    },

    async updateMcpServer(name: string, server: McpServerConfig): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.updateMcpServer(cwd, name, server);
    },

    async deleteMcpServer(name: string): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.deleteMcpServer(cwd, name);
    },

    async listSkills() {
      return runWithLayer(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          return yield* skill.listWithStatus();
        }),
      );
    },

    async toggleSkill(name: string, enabled: boolean) {
      await runWithLayer(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          return yield* (enabled ? skill.enableSkill(name) : skill.disableSkill(name));
        }),
      );
    },

    async listAgents() {
      const cwd = getWorkspaceCwd();
      return settingsService.listAgents(cwd);
    },

    async createAgent(profile: SubagentProfile): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.createAgent(cwd, profile);
    },

    async updateAgent(name: string, profile: SubagentProfile): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.updateAgent(cwd, name, profile);
    },

    async deleteAgent(name: string): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.deleteAgent(cwd, name);
    },

    async setAgentDisabled(name: string, disabled: boolean): Promise<void> {
      settingsService.setAgentDisabled(name, disabled);
    },

    async listHooks(): Promise<UserHookConfig[]> {
      const cwd = getWorkspaceCwd();
      return settingsService.listHooks(cwd);
    },

    async createHook(hook: UserHookConfig): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.createHook(cwd, hook);
    },

    async updateHook(name: string, hook: UserHookConfig): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.updateHook(cwd, name, hook);
    },

    async deleteHook(name: string): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.deleteHook(cwd, name);
    },

    async setHookDisabled(name: string, disabled: boolean): Promise<void> {
      const cwd = getWorkspaceCwd();
      settingsService.setHookDisabled(cwd, name, disabled);
    },

    async getPermissionMode(): Promise<PermissionMode> {
      return getGlobalPermissionMode();
    },

    async setPermissionMode(mode: PermissionMode): Promise<void> {
      setGlobalPermissionMode(mode);
    },
  };
}
