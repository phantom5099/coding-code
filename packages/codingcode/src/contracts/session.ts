import type { ProfileName, TokenUsage, ToolCall } from './types.js';
import type { PermissionMode } from './permission.js';

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

export interface SessionCreateOptions {
  model: string;
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
}
