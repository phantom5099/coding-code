import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../util/error.js';
import type {
  AssistantEvent,
  RollbackEvent,
  SessionEvent,
  SubagentResultEvent,
  SummaryEvent,
  ToolResultEvent,
  UserEvent,
} from './types.js';
import type {
  SessionCreateOptions,
  SessionSummary,
  SessionStoreState,
} from './types.js';
import type { UITurn } from './types.js';
import type { StoredPart } from './types.js';
import type { IncomingPart, TokenUsage } from '../llm/types.js';
import type { ProfileName, PermissionMode } from '../util/enums.js';

export interface SessionShape {
  create(
    cwd: string,
    options: SessionCreateOptions,
    opts?: { parentSessionId?: string; agentName?: string }
  ): Effect.Effect<SessionStoreState, AgentError>;
  load(
    cwd: string,
    sessionId: string,
    parentSessionId?: string
  ): Effect.Effect<SessionStoreState, AgentError>;
  deleteSession(sessionId: string, cwd: string): Effect.Effect<void, AgentError>;
  forkSession(state: SessionStoreState, atTurnId: number): Effect.Effect<string, AgentError>;
  renameSession(state: SessionStoreState, text: string): Effect.Effect<void, AgentError>;
  listSessions(cwd?: string): Effect.Effect<SessionSummary[]>;
  readHistory(state: SessionStoreState): Effect.Effect<SessionEvent[]>;
  /** 落盘入口媒体：嗅探 → 校验 → 写盘，返回落盘形态（文本原样通过，顺序保留）。 */
  materializeInput(
    state: SessionStoreState,
    parts: readonly IncomingPart[]
  ): Effect.Effect<StoredPart[], AgentError>;
  /** 解析资产为 data URL，进程内按 (assetsDir, asset) 缓存。 */
  resolveAssets(
    state: SessionStoreState,
    assets: readonly string[]
  ): Effect.Effect<Map<string, string>, AgentError>;

  recordUser(state: SessionStoreState, content: StoredPart[]): Effect.Effect<UserEvent, AgentError>;
  recordSystem(
    state: SessionStoreState,
    content: StoredPart[]
  ): Effect.Effect<UserEvent, AgentError>;
  recordAssistant(
    state: SessionStoreState,
    content: string,
    toolCalls: AssistantEvent['toolCalls'],
    usage?: TokenUsage
  ): Effect.Effect<AssistantEvent, AgentError>;
  recordToolResult(
    state: SessionStoreState,
    toolName: string,
    toolCallId: string,
    output: string
  ): Effect.Effect<ToolResultEvent, AgentError>;
  recordSubagentResult(
    state: SessionStoreState,
    result: { sessionId: string; agentName: string; content: string }
  ): Effect.Effect<SubagentResultEvent, AgentError>;
  appendSummary(
    state: SessionStoreState,
    summaryText: string,
    startTurnId: number,
    endTurnId: number
  ): Effect.Effect<SummaryEvent, AgentError>;
  rollbackToTurn(
    state: SessionStoreState,
    throughTurnId: number,
    reason: string
  ): Effect.Effect<RollbackEvent, AgentError>;
  readEvents(transcriptPath: string): Effect.Effect<SessionEvent[], AgentError>;
  appendEvent(transcriptPath: string, event: SessionEvent): Effect.Effect<void, AgentError>;
  readUITurns(sessionId: string, cwd: string): Effect.Effect<UITurn[]>;
  setPermissionMode(
    cwd: string,
    sessionId: string,
    mode: PermissionMode,
    parentSessionId?: string
  ): Effect.Effect<void, AgentError>;
  setActiveProfile(
    cwd: string,
    sessionId: string,
    profile: ProfileName,
    parentSessionId?: string
  ): Effect.Effect<void, AgentError>;
  setModel(
    cwd: string,
    sessionId: string,
    model: string,
    parentSessionId?: string
  ): Effect.Effect<void, AgentError>;
}

export class SessionService extends Context.Tag('Session')<SessionService, SessionShape>() {}
