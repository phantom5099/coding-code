export interface SessionMetaEvent {
  type: 'session_meta';
  sessionId: string;
  projectPath: string;
  cwd: string;
  model: string;
  createdAt: string;
  version: string;
  parentSessionId?: string;
  parentAgentId?: string;
  agentName?: string;
}

export interface UserEvent {
  type: 'user';
  turnId: number;
  uuid: string;
  content: string;
  timestamp: string;
}

export interface AssistantEvent {
  type: 'assistant';
  turnId: number;
  uuid: string;
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  model: string;
  timestamp: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  turnId: number;
  uuid: string;
  parentUuid: string;
  toolName: string;
  toolCallId: string;
  output: string;
  timestamp: string;
  tokenCount: number;
}

export interface SummaryEvent {
  type: 'summary';
  uuid: string;
  replaces: string[];
  summaryText: string;
  method: 'prune' | 'collapse-llm' | 'auto-compact' | 'context-collapse';
  timestamp: string;
}

export interface HideMessageEvent {
  type: 'hide';
  uuid: string;
  kind: 'message';
  targetUuid: string;
  reason: string;
  timestamp: string;
}

export interface HideRollbackEvent {
  type: 'hide';
  uuid: string;
  kind: 'rollback';
  throughTurnId: number;
  reason: string;
  timestamp: string;
}

export type HideEvent = HideMessageEvent | HideRollbackEvent;

export interface UnhideEvent {
  type: 'unhide';
  uuid: string;
  targetHideUuid: string;
  timestamp: string;
}

export interface TitleEvent {
  type: 'title';
  uuid: string;
  text: string;
  timestamp: string;
}

export type SessionEvent =
  | SessionMetaEvent
  | UserEvent
  | AssistantEvent
  | ToolResultEvent
  | SummaryEvent
  | HideEvent
  | UnhideEvent
  | TitleEvent;

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
  tokenCountEstimate: number;
  permissionMode: string;
}
