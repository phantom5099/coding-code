import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { PermissionMode } from '../approval/types.js';
import type {
  ActiveProfileName,
  AssistantEvent,
  RollbackEvent,
  SessionEvent,
  SessionIndex,
  SessionStoreState,
  SummaryEvent,
  TokenUsage,
  ToolResultEvent,
  UserEvent,
} from './types.js';

export interface UITurn {
  id: string;
  items: object[];
  status: string;
}

export interface SessionShape {
  create(cwd: string, options: { model: string; activeProfile: ActiveProfileName; permissionMode: PermissionMode }, opts?: { parentSessionId?: string; agentName?: string }): Effect.Effect<SessionStoreState, AgentError>;
  load(cwd: string, sessionId: string): Effect.Effect<SessionStoreState, AgentError>;
  deleteSession(sessionId: string, cwd: string): Effect.Effect<void, AgentError>;
  forkSession(state: SessionStoreState, atTurnId: number): Effect.Effect<string, AgentError>;
  renameSession(state: SessionStoreState, text: string): Effect.Effect<void, AgentError>;
  listSessions(cwd?: string): Effect.Effect<SessionIndex[]>;
  readHistory(state: SessionStoreState): Effect.Effect<SessionEvent[]>;
  recordUser(state: SessionStoreState, content: string): Effect.Effect<UserEvent, AgentError>;
  recordAssistant(state: SessionStoreState, content: string, toolCalls: AssistantEvent['toolCalls'], usage?: TokenUsage): Effect.Effect<AssistantEvent, AgentError>;
  recordToolResult(state: SessionStoreState, toolName: string, toolCallId: string, output: string): Effect.Effect<ToolResultEvent, AgentError>;
  appendSummary(state: SessionStoreState, summaryText: string, startTurnId: number, endTurnId: number): Effect.Effect<SummaryEvent, AgentError>;
  rollbackToTurn(state: SessionStoreState, throughTurnId: number, reason: string): Effect.Effect<RollbackEvent, AgentError>;
  incrementTurn(state: SessionStoreState): number;
  readEvents(transcriptPath: string): SessionEvent[];
  appendEvent(transcriptPath: string, event: SessionEvent): void;
  readUITurns(sessionId: string, cwd: string): Effect.Effect<UITurn[]>;
  findUserMessageForTurn(sessionId: string, turnId: number, cwd: string): Effect.Effect<string>;
  setPermissionMode(cwd: string, sessionId: string, mode: PermissionMode): Effect.Effect<void, AgentError>;
  getPermissionMode(cwd: string, sessionId: string): Effect.Effect<PermissionMode, AgentError>;
  setActiveProfile(cwd: string, sessionId: string, profile: ActiveProfileName): Effect.Effect<void, AgentError>;
  getActiveProfile(cwd: string, sessionId: string): Effect.Effect<ActiveProfileName | undefined, AgentError>;
  getSessionId(state: SessionStoreState): string;
  getTranscriptPath(state: SessionStoreState): string;
  getMessageCount(state: SessionStoreState): number;
}

export class SessionService extends Context.Tag('Session')<SessionService, SessionShape>() {}
