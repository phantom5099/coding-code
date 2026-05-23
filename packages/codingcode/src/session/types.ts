export interface SessionMetaEvent {
  type: 'session_meta';
  sessionId: string;
  projectSlug: string;
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
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
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

export type SessionEvent =
  | SessionMetaEvent
  | UserEvent
  | AssistantEvent
  | ToolResultEvent;

export interface SessionIndex {
  sessionId: string;
  projectSlug: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title: string;
  currentTurnId: number;
  tokenCountEstimate: number;
  projectedRanges: Array<[number, number]>;
  lastUncoveredByteOffset: number;
  lastProjectionAt?: string;
  projectionCount: number;
  lastCompressionFailures: number;
}
