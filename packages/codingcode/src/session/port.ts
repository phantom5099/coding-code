import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type {
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
import type { ProfileName } from '../core/types.js';
import type { PermissionMode } from '../approval/types.js';

export type UITurnItem =
  | { id: string; type: 'message'; role: 'user' | 'assistant'; content: string; partial?: boolean }
  | {
      id: string;
      type: 'tool_call';
      name: string;
      args: Record<string, unknown>;
      status: 'pending' | 'approved' | 'rejected' | 'running';
    }
  | {
      id: string;
      type: 'tool_result';
      callId: string;
      name: string;
      output: string;
      exitCode?: number;
      filePath?: string;
      diff?: string;
      insertions?: number;
      deletions?: number;
    }
  | {
      id: string;
      type: 'summary';
      content: string;
      startTurnId: number;
      endTurnId: number;
    }
  | { id: string; type: 'reasoning'; content: string; isVisible: boolean }
  | { id: string; type: 'error'; message: string; code?: string };

export interface UITurn {
  id: string;
  items: UITurnItem[];
  status: 'running' | 'completed' | 'error';
}

export interface SessionShape {
  create(cwd: string, options: { model: string; activeProfile: ProfileName; permissionMode: PermissionMode }, opts?: { parentSessionId?: string; agentName?: string }): Effect.Effect<SessionStoreState, AgentError>;
  load(cwd: string, sessionId: string): Effect.Effect<SessionStoreState, AgentError>;
  deleteSession(sessionId: string, cwd: string): Effect.Effect<void, AgentError>;
  forkSession(state: SessionStoreState, atTurnId: number): Effect.Effect<string, AgentError>;
  renameSession(state: SessionStoreState, text: string): Effect.Effect<void, AgentError>;
  listSessions(cwd?: string): Effect.Effect<SessionIndex[]>;
  readHistory(state: SessionStoreState): Effect.Effect<SessionEvent[]>;
  recordUser(state: SessionStoreState, content: string): Effect.Effect<UserEvent, AgentError>;
  recordSystem(state: SessionStoreState, content: string): Effect.Effect<UserEvent, AgentError>;
  recordAssistant(state: SessionStoreState, content: string, toolCalls: AssistantEvent['toolCalls'], usage?: TokenUsage): Effect.Effect<AssistantEvent, AgentError>;
  recordToolResult(state: SessionStoreState, toolName: string, toolCallId: string, output: string): Effect.Effect<ToolResultEvent, AgentError>;
  appendSummary(state: SessionStoreState, summaryText: string, startTurnId: number, endTurnId: number): Effect.Effect<SummaryEvent, AgentError>;
  rollbackToTurn(state: SessionStoreState, throughTurnId: number, reason: string): Effect.Effect<RollbackEvent, AgentError>;
  readEvents(transcriptPath: string): SessionEvent[];
  appendEvent(transcriptPath: string, event: SessionEvent): void;
  readUITurns(sessionId: string, cwd: string): Effect.Effect<UITurn[]>;
  setPermissionMode(cwd: string, sessionId: string, mode: PermissionMode): Effect.Effect<void, AgentError>;
  setActiveProfile(cwd: string, sessionId: string, profile: ProfileName): Effect.Effect<void, AgentError>;
}

export class SessionService extends Context.Tag('Session')<SessionService, SessionShape>() {}

// direct/sessions.ts 实际使用的消费视图，编译期锁定真实耦合面
export type SessionStorePort = Pick<
  SessionShape,
  | 'create'
  | 'load'
  | 'deleteSession'
  | 'forkSession'
  | 'listSessions'
  | 'readUITurns'
  | 'setActiveProfile'
  | 'setPermissionMode'
>;

// direct/agent-runtime.ts 与 direct/settings.ts 只读/只写权限模式
export type SessionStatePort = Pick<SessionShape, 'load' | 'setPermissionMode'>;
