export interface SessionMetaEvent {
  type: 'session_meta';
  sessionId: string;
  projectSlug: string;
  cwd: string;
  model: string;
  createdAt: string;
  version: string;
}

export interface UserEvent {
  type: 'user';
  uuid: string;
  content: string;
  timestamp: string;
}

export interface AssistantEvent {
  type: 'assistant';
  uuid: string;
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  model: string;
  timestamp: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  uuid: string;
  parentUuid: string;
  toolName: string;
  toolCallId: string;
  output: string;
  timestamp: string;
}

export interface CompactBoundaryEvent {
  type: 'compact_boundary';
  uuid: string;
  summary: string;
  replacedRange: [number, number];
  messageCount: number;
  timestamp: string;
}

export type SessionEvent =
  | SessionMetaEvent
  | UserEvent
  | AssistantEvent
  | ToolResultEvent
  | CompactBoundaryEvent;

export interface SessionIndex {
  sessionId: string;
  projectSlug: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title: string;
}
