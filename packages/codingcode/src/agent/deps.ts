import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { ToolCall, Message, ToolDescription } from '../core/types.js';
import type { SessionStoreState, SessionEvent, TokenUsage, UserEvent } from '../session/types.js';
import type { ToolResultUnion, ToolLookup } from '../tools/port.js';
import type { ToolDefinition } from '../tools/types.js';
import type { LLMClient } from '../llm/client.js';
import type { AgentProfileName } from './profile.js';
import type { PermissionMode } from '../approval/types.js';
import type { ApprovalDecision } from '../approval/types.js';

export class SessionPort extends Context.Tag('AgentSessionPort')<SessionPort, {
  load(cwd: string, sid: string): Effect.Effect<SessionStoreState, AgentError>;
  create(cwd: string, opts: { model: string; activeProfile: AgentProfileName; permissionMode: PermissionMode }, extra?: { parentSessionId?: string; agentName?: string }): Effect.Effect<SessionStoreState, AgentError>;
  recordUser(state: SessionStoreState, content: string): Effect.Effect<UserEvent, AgentError>;
  recordSystem(state: SessionStoreState, content: string): Effect.Effect<UserEvent, AgentError>;
  recordAssistant(state: SessionStoreState, content: string, toolCalls: any[], usage?: TokenUsage): Effect.Effect<any, AgentError>;
  recordToolResult(state: SessionStoreState, name: string, id: string, output: string): Effect.Effect<any, AgentError>;
  getActiveProfile(cwd: string, sid: string): Effect.Effect<AgentProfileName | undefined, AgentError>;
  setPermissionMode(cwd: string, sid: string, mode: PermissionMode): Effect.Effect<void, AgentError>;
  setActiveProfile(cwd: string, sid: string, profile: AgentProfileName): Effect.Effect<void, AgentError>;
}>() {}

export class ToolExecutorPort extends Context.Tag('AgentToolExecutorPort')<ToolExecutorPort, {
  executeBatch(toolCalls: ToolCall[], sid: string, opts: {
    turnId?: number; projectPath?: string; signal?: AbortSignal;
    approval?: any; toolLookup?: ToolLookup; permissionMode?: PermissionMode;
  }): Effect.Effect<ToolResultUnion[], never, any>;
}>() {}

export class CheckpointPort extends Context.Tag('AgentCheckpointPort')<CheckpointPort, {
  snapshotBaseline(cwd: string, sid: string, turnId: number): Effect.Effect<void>;
  snapshotFinal(cwd: string, sid: string, turnId: number): Effect.Effect<void>;
}>() {}

export class HookPort extends Context.Tag('AgentHookPort')<HookPort, {
  emit(point: string, payload: Record<string, unknown>): Effect.Effect<void>;
  emitDecision(point: string, payload: Record<string, unknown>): Effect.Effect<any>;
  disposeSession(sid: string): Effect.Effect<void>;
}>() {}

export class ApprovalPort extends Context.Tag('AgentApprovalPort')<ApprovalPort, {
  evaluate(req: { tool: string; input: Record<string, unknown>; callId?: string; sessionId: string; projectPath?: string; permissionMode?: PermissionMode }): Effect.Effect<ApprovalDecision>;
}>() {}

export class SkillPort extends Context.Tag('AgentSkillPort')<SkillPort, {
  extractSkill(cwd: string, query: string): Effect.Effect<[any, string]>;
}>() {}

export class McpPort extends Context.Tag('AgentMcpPort')<McpPort, {
  listProjectMcpTools(cwd: string): ToolDefinition[];
  syncConnections(cwd: string): Effect.Effect<void>;
}>() {}

export class ContextPort extends Context.Tag('AgentContextPort')<ContextPort, {
  assemblePayload(
    transcriptPath: string,
    contextWindow: number,
    llm: LLMClient | null
  ): Promise<{
    messages: Message[];
    compressed: boolean;
    released: number;
    promptEstimate: number;
  }>;
}>() {}

export class MemoryPort extends Context.Tag('AgentMemoryPort')<MemoryPort, {
  loadMemoryForPrompt(cwd: string): string;
  flushSessionToMemory(sid: string, llm: LLMClient | null, cwd: string): Promise<any>;
}>() {}

export class LlmPort extends Context.Tag('AgentLlmPort')<LlmPort, {
  getLLMClient(): Effect.Effect<LLMClient, AgentError>;
}>() {}

export class RulesPort extends Context.Tag('AgentRulesPort')<RulesPort, {
  getAllRules(cwd?: string): string;
  evictProjectRules(cwd: string): void;
}>() {}

export class TodoPort extends Context.Tag('AgentTodoPort')<TodoPort, {
  read(sid: string): Array<{ step: string; status: string }>;
}>() {}

/**
 * 工具执行期依赖的注入能力。
 *
 * agent loop 在独立 runtime（Effect.runFork）中执行工具，而工具（todo_write、
 * dispatch_agent 等）的 `execute()` 内部会 `yield*` 具体服务（TodoService、
 * HookService、McpService、SubagentRunnerService）。这些服务是"工具执行期依赖"，
 * 与 agent 自身无关，agent 不应直接 import 它们的具体 Tag。
 *
 * 因此这里只暴露一个抽象能力：`provide` 把一个 effect 包装成"工具执行期服务已就绪"的
 * effect。具体依赖哪些服务、如何注入，由组合根（layer.ts 的 ToolEnvLayer）负责，
 * agent 对此一无所知 —— 这才是真正的依赖倒置。
 */
export interface ToolEnv {
  provide<R, E, A>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, never>;
}

export class ToolEnvPort extends Context.Tag('AgentToolEnvPort')<ToolEnvPort, {
  getToolEnv(): Effect.Effect<ToolEnv, AgentError, any>;
}>() {}

/**
 * 工具目录抽象：agent 只把"自己需要的工具名字名单"（toolNames）交给工具模块注册，
 * 拿到"注册好的成品"（tools 描述列表 + lookup 查找），loop 里直接消费、不再查询。
 *
 * agent 不接触任何具体工具定义与注册逻辑 —— 名字名单由 agent 侧按 profile 静态给出
 * （build/plan 各有各的名单），工具模块内部维护"名字 -> 定义"全量表并按名装配。
 * MCP 工具是运行时动态对象（非静态名单可覆盖），故一并传入。
 */
export interface ToolCatalog {
  tools: ToolDescription[];
  lookup: ToolLookup;
}

export class ToolCatalogPort extends Context.Tag('AgentToolCatalogPort')<ToolCatalogPort, {
  register(toolNames: readonly string[], mcpTools: ToolDefinition<any>[]): ToolCatalog;
}>() {}
