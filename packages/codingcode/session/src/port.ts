import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError, PermissionMode } from '@codingcode/util';
import type { IncomingPart } from '@codingcode/model';
import type {
  AssistantEvent,
  CreateSessionCommand,
  RollbackEvent,
  SessionEvent,
  SessionKey,
  SessionLocator,
  SessionStoreState,
  SessionSummary,
  StoredPart,
  SummaryEvent,
  ToolResultEvent,
  UITurn,
  UserEvent,
} from './types.js';

export type AssistantRecordInput = Omit<AssistantEvent, 'type' | 'turnId'>;
export type ToolResultRecordInput = Omit<ToolResultEvent, 'type' | 'turnId'>;
export type SummaryRecordInput = Omit<SummaryEvent, 'type' | 'uuid'>;
export type RollbackRecordInput = Omit<RollbackEvent, 'type'>;

export interface SessionShape {
  create(cmd: CreateSessionCommand): Effect.Effect<SessionStoreState, AgentError>;
  load(locator: SessionLocator): Effect.Effect<SessionStoreState, AgentError>;
  deleteSession(key: SessionKey): Effect.Effect<void, AgentError>;
  forkSession(state: SessionStoreState, atTurnId: number): Effect.Effect<string, AgentError>;
  renameSession(state: SessionStoreState, text: string): Effect.Effect<void, AgentError>;
  listSessions(cwd?: string): Effect.Effect<SessionSummary[]>;
  readHistory(state: SessionStoreState): Effect.Effect<SessionEvent[]>;
  materializeInput(
    state: SessionStoreState,
    parts: readonly IncomingPart[]
  ): Effect.Effect<StoredPart[], AgentError>;
  resolveAssets(
    cwd: string,
    assets: readonly string[]
  ): Effect.Effect<Map<string, string>, AgentError>;

  recordUser(state: SessionStoreState, content: StoredPart[]): Effect.Effect<UserEvent, AgentError>;
  /** steer 输入：归属当前回合，不递增 turnId、不改标题 */
  recordUserInput(
    state: SessionStoreState,
    content: StoredPart[]
  ): Effect.Effect<UserEvent, AgentError>;
  recordSystem(
    state: SessionStoreState,
    content: StoredPart[]
  ): Effect.Effect<UserEvent, AgentError>;
  recordAssistant(
    state: SessionStoreState,
    entry: AssistantRecordInput
  ): Effect.Effect<AssistantEvent, AgentError>;
  recordToolResult(
    state: SessionStoreState,
    result: ToolResultRecordInput
  ): Effect.Effect<ToolResultEvent, AgentError>;
  appendSummary(
    state: SessionStoreState,
    summary: SummaryRecordInput
  ): Effect.Effect<SummaryEvent, AgentError>;
  rollbackToTurn(
    state: SessionStoreState,
    cmd: RollbackRecordInput
  ): Effect.Effect<RollbackEvent, AgentError>;
  readEvents(locator: SessionLocator): Effect.Effect<SessionEvent[], AgentError>;
  appendEvent(locator: SessionLocator, event: SessionEvent): Effect.Effect<void, AgentError>;
  readUITurns(key: SessionKey): Effect.Effect<UITurn[]>;
  setPermissionMode(
    locator: SessionLocator,
    mode: PermissionMode
  ): Effect.Effect<void, AgentError>;
  setModel(locator: SessionLocator, model: string): Effect.Effect<void, AgentError>;
}

export class SessionService extends Context.Tag('Session')<SessionService, SessionShape>() {}
