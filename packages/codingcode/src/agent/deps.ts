import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type {
  Message,
  ToolCall,
  ToolDescription,
  TodoItem,
  TokenUsage,
  ProfileName,
} from '../contracts/types.js';
import type { SessionCreateOptions, SessionStoreState } from '../contracts/session.js';
import type { HookDecision, HookPoint } from '../contracts/hooks.js';
import type { Skill } from '../contracts/skill.js';
import type { ApprovalDecision, PermissionMode } from '../contracts/permission.js';
import type { LLMClient } from '../contracts/provider.js';
import type { ToolLookup, ToolResult } from '../contracts/tool.js';

export class SessionPort extends Context.Tag('AgentSessionPort')<SessionPort, {
  load(cwd: string, sid: string): Effect.Effect<SessionStoreState, AgentError>;
  create(cwd: string, opts: SessionCreateOptions, extra?: { parentSessionId?: string; agentName?: string }): Effect.Effect<SessionStoreState, AgentError>;
  recordUser(state: SessionStoreState, content: string): Effect.Effect<number, AgentError>;
  recordSystem(state: SessionStoreState, content: string): Effect.Effect<void, AgentError>;
  recordAssistant(state: SessionStoreState, content: string, toolCalls: ToolCall[], usage?: TokenUsage): Effect.Effect<void, AgentError>;
  recordToolResult(state: SessionStoreState, name: string, id: string, output: string): Effect.Effect<void, AgentError>;
  setPermissionMode(cwd: string, sid: string, mode: PermissionMode): Effect.Effect<void, AgentError>;
  setActiveProfile(cwd: string, sid: string, profile: ProfileName): Effect.Effect<void, AgentError>;
}>() {}

export class ToolExecutorPort extends Context.Tag('AgentToolExecutorPort')<ToolExecutorPort, {
  executeBatch(toolCalls: ToolCall[], sid: string, opts: {
    turnId?: number; projectPath?: string; signal?: AbortSignal;
    toolLookup?: ToolLookup;
  }): Effect.Effect<ToolResult[], never, any>;
}>() {}

export class CheckpointPort extends Context.Tag('AgentCheckpointPort')<CheckpointPort, {
  snapshotBaseline(cwd: string, sid: string, turnId: number): Effect.Effect<void>;
  snapshotFinal(cwd: string, sid: string, turnId: number): Effect.Effect<void>;
}>() {}

export class HookPort extends Context.Tag('AgentHookPort')<HookPort, {
  emit(point: HookPoint, payload: Record<string, unknown>): Effect.Effect<void>;
  emitDecision(point: HookPoint, payload: Record<string, unknown>): Effect.Effect<HookDecision | null>;
  disposeSession(sid: string): Effect.Effect<void>;
}>() {}

/** 审批请求：工具 + 调用上下文 + 策略参数。仅服务 ApprovalPort.evaluate 的参数，归调用方。 */
export interface ApprovalRequest {
  tool: string;
  input: Record<string, unknown>;
  callId?: string;
  sessionId: string;
  projectPath?: string;
  permissionMode?: PermissionMode;
  profile?: ProfileName;
}

export class ApprovalPort extends Context.Tag('AgentApprovalPort')<ApprovalPort, {
  evaluate(req: ApprovalRequest): Effect.Effect<ApprovalDecision>;
}>() {}

export class SkillPort extends Context.Tag('AgentSkillPort')<SkillPort, {
  extractSkill(cwd: string, query: string): Effect.Effect<[Skill | undefined, string]>;
}>() {}

export class McpPort extends Context.Tag('AgentMcpPort')<McpPort, {
  syncConnections(cwd: string): Effect.Effect<void>;
}>() {}

export class ContextPort extends Context.Tag('AgentContextPort')<ContextPort, {
  willCompact(transcriptPath: string, contextWindow: number): Promise<boolean>;
  assemblePayload(
    transcriptPath: string,
    contextWindow: number,
    llm: LLMClient | null
  ): Promise<Message[]>;
}>() {}

export class MemoryPort extends Context.Tag('AgentMemoryPort')<MemoryPort, {
  loadMemoryForPrompt(cwd: string): string;
  flushSessionToMemory(sid: string, llm: LLMClient | null, cwd: string): Promise<{ written: boolean; bytes: number }>;
}>() {}

export class LlmPort extends Context.Tag('AgentLlmPort')<LlmPort, {
  getLLMClient(): Effect.Effect<LLMClient, AgentError>;
}>() {}

export class RulesPort extends Context.Tag('AgentRulesPort')<RulesPort, {
  getAllRules(cwd?: string): string;
  evictProjectRules(cwd: string): void;
}>() {}

export class TodoPort extends Context.Tag('AgentTodoPort')<TodoPort, {
  read(sid: string): TodoItem[];
}>() {}

export interface ToolEnv {
  provide<R, E, A>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, never>;
}

export class ToolEnvPort extends Context.Tag('AgentToolEnvPort')<ToolEnvPort, {
  getToolEnv(): Effect.Effect<ToolEnv, never, any>;
}>() {}

export interface ToolCatalog {
  tools: ToolDescription[];
  lookup: ToolLookup;
}

export class ToolCatalogPort extends Context.Tag('AgentToolCatalogPort')<ToolCatalogPort, {
  register(toolNames: readonly string[], cwd: string): Effect.Effect<ToolCatalog>;
}>() {}
