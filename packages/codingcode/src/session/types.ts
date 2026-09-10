import type { ProfileName, TokenUsage, ToolCall } from '../core/types.js';
import type { PermissionMode } from '../approval/types.js';

export type { TokenUsage };

export interface SessionMetaEvent {
  type: 'session_meta';
  sessionId: string;
  cwd: string;
  createdAt: string;
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
  parentSessionId?: string;
  agentName?: string;
}

export interface UserEvent {
  type: 'user';
  turnId: number;
  content: string;
  source?: 'user' | 'system';
}

export interface AssistantEvent {
  type: 'assistant';
  turnId: number;
  content: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
}

export interface ToolResultEvent {
  type: 'tool_result';
  turnId: number;
  toolCallId: string;
  toolName: string;
  output: string;
}

export interface SummaryEvent {
  type: 'summary';
  uuid: string;
  startTurnId: number;
  endTurnId: number;
  summaryText: string;
}

export interface RollbackEvent {
  type: 'rollback';
  throughTurnId: number;
  reason: string;
}

export interface CompactEvent {
  type: 'compact';
  uuid: string;
  startTurnId: number;
  endTurnId: number;
}

export type SessionEvent =
  | SessionMetaEvent
  | UserEvent
  | AssistantEvent
  | ToolResultEvent
  | SummaryEvent
  | RollbackEvent
  | CompactEvent;

export interface SessionIndex {
  sessionId: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title: string;
  currentTurnId: number;
  usage: TokenUsage | undefined;
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
  memorySnapshot?: string;
  parentSessionId?: string;
}

export interface SessionStoreState {
  sessionId: string;
  cwd: string;
  messageCount: number;
  sessionMeta: SessionMetaEvent | null;
  model: string;
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
  title: string;
  currentTurnId: number;
  usage: TokenUsage | undefined;
  memorySnapshot: string;
  parentSessionId?: string;
}
