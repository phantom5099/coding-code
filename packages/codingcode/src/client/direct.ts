import { Effect } from 'effect';
import type { AgentEvent } from '../agent/agent.js';
import { sendMessage } from '../orchestration/index.js';
import { SessionService } from '../session/store.js';
import { ContextService } from '../context/context.js';
import { ApprovalWaitService } from '../approval/async-confirm.js';
import { parseApprovalResponse } from '../approval/response.js';
import { AppLayer } from '../layer.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import { getActiveEntry, getLLMClient, listModels, switchModel as switchActiveModel } from '../llm/factory.js';
import { getWorkspaceCwd } from '../core/workspace.js';
import { getSubagentEnabledState, setSubagentEnabledState, EXPLORE_PROFILE } from '../subagent/registry.js';
import type { SubagentProfile } from '../subagent/registry.js';
import { loadAgentProfiles } from '../subagent/loader.js';
import { McpService } from '../mcp/index.js';
import type { McpServerConfig, McpStatus } from '../mcp/types.js';
import { SkillService } from '../skills/index.js';
import { getMemoryEnabled, setMemoryEnabled } from '../memory/index.js';
import type { UserHookConfig } from '../hooks/config.js';
import { getGlobalPermissionMode, setGlobalPermissionMode } from '../approval/index.js';
import type { PermissionMode } from '../approval/types.js';

export type StreamChunk = string
  | { type: 'approval_request'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; output: string; ok: boolean }
  | { type: 'tool_denied'; name: string; reason: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'todo_update'; items: ReadonlyArray<{ step: string; status: string }> };

export interface AgentClient {
  sendMessage(input: string): AsyncGenerator<StreamChunk>;
  sendApprovalResponse(id: string, response: string): Promise<void>;
  resumeSession(sid: string): Promise<any>;
  listSessions(): Promise<any[]>;
  listModels(): Promise<any>;
  switchModel(id: string): Promise<void>;
  getSessionId(): string;
  classifyLastCompletedChanges(): Promise<{ agentModified: string[]; unknownSource: string[] } | null>;
  revertLastCompleted(mode: 'agent' | 'all'): Promise<void>;
  revertCheckpoint(turnId: number, mode: 'agent' | 'all'): Promise<void>;
  forwardLastRevert(): Promise<void>;
  hasForwardStack(): Promise<boolean>;
  getCheckpoints(): Promise<Array<{ turnId: number; title: string; agentModified: string[]; unknownSource: string[] }>>;
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
        yield { type: 'tool_start', name: event.name, args: event.args };
        break;
      case 'ToolResult':
        yield { type: 'tool_result', id: event.id, name: event.name, output: event.output, ok: event.ok };
        break;
      case 'ToolDenied':
        yield { type: 'tool_denied', name: event.name, reason: event.reason };
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
            // Re-enter loop with fresh notify; same `pending` continues racing
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

    async classifyLastCompletedChanges() {
      if (!currentSessionId) return null;
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          const projectPath = getWorkspaceCwd();
          const turnIds = checkpoint.getCompletedTurns(projectPath, currentSessionId);
          if (turnIds.length === 0) return null;
          const lastTurn = turnIds[turnIds.length - 1];
          if (lastTurn === undefined) return null;
          return checkpoint.classifyChanges(projectPath, currentSessionId, lastTurn);
        }),
      );
    },

    async revertLastCompleted(mode: 'agent' | 'all') {
      if (!currentSessionId) return;
      await runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          const projectPath = getWorkspaceCwd();
          const turnIds = checkpoint.getCompletedTurns(projectPath, currentSessionId);
          if (turnIds.length === 0) return;
          const lastTurn = turnIds[turnIds.length - 1];
          if (lastTurn === undefined) return;
          const changes = checkpoint.classifyChanges(projectPath, currentSessionId, lastTurn);
          if (!changes) return;

          const files = mode === 'agent' ? changes.agentModified : [...changes.agentModified, ...changes.unknownSource];
          if (files.length > 0) {
            checkpoint.revertFiles(projectPath, currentSessionId, lastTurn, files);
          }
        }),
      );
    },

    async revertCheckpoint(turnId: number, mode: 'agent' | 'all') {
      if (!currentSessionId) return;
      await runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          const projectPath = getWorkspaceCwd();
          const changes = checkpoint.classifyChanges(projectPath, currentSessionId, turnId);
          if (!changes) return;
          const files = mode === 'agent' ? changes.agentModified : [...changes.agentModified, ...changes.unknownSource];
          if (files.length > 0) {
            checkpoint.revertFiles(projectPath, currentSessionId, turnId, files);
          }
        }),
      );
    },

    async forwardLastRevert() {
      if (!currentSessionId) return;
      await runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          checkpoint.forward(getWorkspaceCwd(), currentSessionId);
        }),
      );
    },

    async hasForwardStack() {
      if (!currentSessionId) return false;
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.hasForwardStack(getWorkspaceCwd(), currentSessionId);
        }),
      );
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
      const { loadMcpConfig, writeMcpConfig } = await import('../mcp/config.js');
      const servers = loadMcpConfig(cwd);
      if (servers.some(s => s.name === server.name)) {
        throw new Error(`MCP server '${server.name}' already exists`);
      }
      servers.push(server);
      writeMcpConfig(cwd, servers);
    },

    async updateMcpServer(name: string, server: McpServerConfig): Promise<void> {
      const cwd = getWorkspaceCwd();
      const { loadMcpConfig, writeMcpConfig } = await import('../mcp/config.js');
      const servers = loadMcpConfig(cwd);
      const idx = servers.findIndex(s => s.name === name);
      if (idx === -1) throw new Error(`MCP server '${name}' not found`);
      if (server.name !== name && servers.some(s => s.name === server.name)) {
        throw new Error(`MCP server '${server.name}' already exists`);
      }
      servers[idx] = server;
      writeMcpConfig(cwd, servers);
    },

    async deleteMcpServer(name: string): Promise<void> {
      const cwd = getWorkspaceCwd();
      const { loadMcpConfig, writeMcpConfig } = await import('../mcp/config.js');
      const servers = loadMcpConfig(cwd).filter(s => s.name !== name);
      writeMcpConfig(cwd, servers);
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
      const custom = loadAgentProfiles(cwd);
      const { isAgentDisabledState } = await import('../subagent/registry.js');
      return [EXPLORE_PROFILE, ...custom].map(a => ({
        name: a.name, description: a.description, tools: a.tools,
        mcpServers: a.mcpServers,
        readonly: a.readonly, maxSteps: a.maxSteps, model: a.model,
        disabled: isAgentDisabledState(a.name),
      }));
    },

    async createAgent(profile: SubagentProfile): Promise<void> {
      const cwd = getWorkspaceCwd();
      const { writeAgentProfile, loadAgentProfiles } = await import('../subagent/loader.js');
      const existing = loadAgentProfiles(cwd);
      if (existing.some(a => a.name === profile.name)) {
        throw new Error(`Agent '${profile.name}' already exists`);
      }
      writeAgentProfile(cwd, profile);
    },

    async updateAgent(name: string, profile: SubagentProfile): Promise<void> {
      const cwd = getWorkspaceCwd();
      const { updateAgentProfile, loadAgentProfiles } = await import('../subagent/loader.js');
      const existing = loadAgentProfiles(cwd);
      if (!existing.some(a => a.name === name)) {
        throw new Error(`Agent '${name}' not found`);
      }
      if (profile.name !== name && existing.some(a => a.name === profile.name)) {
        throw new Error(`Agent '${profile.name}' already exists`);
      }
      updateAgentProfile(cwd, name, profile);
    },

    async deleteAgent(name: string): Promise<void> {
      const cwd = getWorkspaceCwd();
      const { deleteAgentProfile } = await import('../subagent/loader.js');
      deleteAgentProfile(cwd, name);
    },

    async setAgentDisabled(name: string, disabled: boolean): Promise<void> {
      const { setAgentDisabledState } = await import('../subagent/registry.js');
      setAgentDisabledState(name, disabled);
    },

    async listHooks(): Promise<UserHookConfig[]> {
      const cwd = getWorkspaceCwd();
      const { loadHookConfigs } = await import('../hooks/config.js');
      return loadHookConfigs(cwd);
    },

    async createHook(hook: UserHookConfig): Promise<void> {
      const cwd = getWorkspaceCwd();
      const { loadHookConfigs, writeHookConfigs } = await import('../hooks/config.js');
      const hooks = loadHookConfigs(cwd);
      if (hooks.some(h => h.name === hook.name)) {
        throw new Error(`Hook '${hook.name}' already exists`);
      }
      hooks.push(hook);
      writeHookConfigs(cwd, hooks);
    },

    async updateHook(name: string, hook: UserHookConfig): Promise<void> {
      const cwd = getWorkspaceCwd();
      const { loadHookConfigs, writeHookConfigs } = await import('../hooks/config.js');
      const hooks = loadHookConfigs(cwd);
      const idx = hooks.findIndex(h => h.name === name);
      if (idx === -1) throw new Error(`Hook '${name}' not found`);
      if (hook.name !== name && hooks.some(h => h.name === hook.name)) {
        throw new Error(`Hook '${hook.name}' already exists`);
      }
      hooks[idx] = hook;
      writeHookConfigs(cwd, hooks);
    },

    async deleteHook(name: string): Promise<void> {
      const cwd = getWorkspaceCwd();
      const { loadHookConfigs, writeHookConfigs } = await import('../hooks/config.js');
      const hooks = loadHookConfigs(cwd).filter(h => h.name !== name);
      writeHookConfigs(cwd, hooks);
    },

    async setHookDisabled(name: string, disabled: boolean): Promise<void> {
      // 运行时立即生效
      const { setHookRuntimeEnabled } = await import('../hooks/executor.js');
      setHookRuntimeEnabled(name, !disabled);

      // 持久化到 YAML
      const cwd = getWorkspaceCwd();
      const { loadHookConfigs, writeHookConfigs } = await import('../hooks/config.js');
      const hooks = loadHookConfigs(cwd);
      const hook = hooks.find(h => h.name === name);
      if (hook) {
        hook.enabled = !disabled;
        writeHookConfigs(cwd, hooks);
      }
    },

    async getPermissionMode(): Promise<PermissionMode> {
      return getGlobalPermissionMode();
    },

    async setPermissionMode(mode: PermissionMode): Promise<void> {
      setGlobalPermissionMode(mode);
    },
  };
}
