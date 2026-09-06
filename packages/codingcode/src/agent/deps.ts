import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { ToolCall, Message } from '../core/types.js';
import type { SessionStoreState, SessionEvent, TokenUsage } from '../session/types.js';
import type { ToolResultUnion, ToolLookup } from '../tools/port.js';
import type { ToolDefinition } from '../tools/types.js';
import type { LLMClient } from '../llm/client.js';
import type { AgentProfileName } from './profile.js';
import type { PermissionMode } from '../approval/types.js';
import type { ApprovalDecision } from '../approval/types.js';

export class SessionPort extends Context.Tag('AgentSessionPort')<SessionPort, {
  load(cwd: string, sid: string): Effect.Effect<SessionStoreState, AgentError>;
  create(cwd: string, opts: { model: string; activeProfile: AgentProfileName; permissionMode: PermissionMode }, extra?: { parentSessionId?: string; agentName?: string }): Effect.Effect<SessionStoreState, AgentError>;
  recordUser(state: SessionStoreState, content: string): Effect.Effect<any, AgentError>;
  recordAssistant(state: SessionStoreState, content: string, toolCalls: any[], usage?: TokenUsage): Effect.Effect<any, AgentError>;
  recordToolResult(state: SessionStoreState, name: string, id: string, output: string): Effect.Effect<any, AgentError>;
  incrementTurn(state: SessionStoreState): number;
  getTranscriptPath(state: SessionStoreState): string;
  getActiveProfile(cwd: string, sid: string): Effect.Effect<AgentProfileName | undefined, AgentError>;
  setPermissionMode(cwd: string, sid: string, mode: PermissionMode): Effect.Effect<void, AgentError>;
  setActiveProfile(cwd: string, sid: string, profile: AgentProfileName): Effect.Effect<void, AgentError>;
}>() {}

export class ToolExecutorPort extends Context.Tag('AgentToolExecutorPort')<ToolExecutorPort, {
  executeBatch(toolCalls: ToolCall[], sid: string, opts: {
    turnId?: number; projectPath?: string; signal?: AbortSignal;
    approval?: any; toolLookup?: ToolLookup;
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
  evaluate(req: { tool: string; input: Record<string, unknown>; callId?: string; sessionId: string; projectPath?: string }): Effect.Effect<ApprovalDecision>;
  fork(opts?: { permissionMode?: PermissionMode }): Effect.Effect<any>;
}>() {}

export class SkillPort extends Context.Tag('AgentSkillPort')<SkillPort, {
  extractSkill(cwd: string, query: string): Effect.Effect<[any, string]>;
  evictProject(cwd: string): Effect.Effect<void>;
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
