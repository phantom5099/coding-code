export type SessionMode = 'plan' | 'build';

export interface SessionMetaEvent {
  type: 'session_meta';
  sessionId: string;
  projectPath: string;
  cwd: string;
  createdAt: string;
  mode: SessionMode;
  permissionMode: import('../approval/types.js').PermissionMode;
  parentSessionId?: string;
  agentName?: string;
}

export interface UserEvent {
  type: 'user';
  turnId: number;
  content: string;
}

export interface AssistantEvent {
  type: 'assistant';
  turnId: number;
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
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

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface SessionIndex {
  sessionId: string;
  projectPath: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title: string;
  currentTurnId: number;
  usage: TokenUsage | undefined;
  mode: SessionMode;
  permissionMode: import('../approval/types.js').PermissionMode;
  memorySnapshot?: string;
  activeProfile?: string;
}

export interface SessionStoreState {
  sessionId: string;
  cwd: string;
  projectPath: string;
  transcriptPath: string;
  indexPath: string;
  messageCount: number;
  sessionMeta: SessionMetaEvent | null;
  model: string;
  mode: SessionMode;
  permissionMode: import('../approval/types.js').PermissionMode;
  title: string;
  currentTurnId: number;
  usage: TokenUsage | undefined;
  memorySnapshot: string;
  activeProfile?: string;
}
