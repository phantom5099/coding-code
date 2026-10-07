import type { TokenUsage, ToolCall } from '../llm/types.js';

export const PLAN_PROFILE_NAME = 'plan' as const;
export const BUILD_PROFILE_NAME = 'build' as const;

export const PROFILE_NAMES = [PLAN_PROFILE_NAME, BUILD_PROFILE_NAME] as const;

export type ProfileName = (typeof PROFILE_NAMES)[number];

export function isPlanProfile(name: string | null | undefined): boolean {
  return name === PLAN_PROFILE_NAME;
}

export interface AvailableProfile {
  name: ProfileName;
  description: string;
}

export const AVAILABLE_PROFILES: AvailableProfile[] = [
  { name: PLAN_PROFILE_NAME, description: 'Planning agent' },
  { name: BUILD_PROFILE_NAME, description: 'Build agent' },
];

export const PERMISSION_MODES = ['askBeforeExec', 'bypass'] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface SessionMetaEvent {
  type: 'session_meta';
  sessionId: string;
  cwd: string;
  createdAt: string;
  model: string;
  title: string;
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

export const SUBAGENT_RESULT_PREFIX = 'Message Type: FINAL_ANSWER';

export interface SubagentResultEvent {
  type: 'subagent_result';
  sessionId: string;
  agentName: string;
  content: string;
}

export type SessionEvent =
  | SessionMetaEvent
  | UserEvent
  | AssistantEvent
  | ToolResultEvent
  | SummaryEvent
  | RollbackEvent
  | CompactEvent
  | SubagentResultEvent;

export interface SessionSummary extends SessionMetaEvent {
  updatedAt: string;
  usage?: TokenUsage;
}

export interface SessionStoreState extends SessionMetaEvent {
  currentTurnId: number;
  memorySnapshot: string;
  usage: TokenUsage | undefined;
}

export interface SessionCreateOptions {
  model: string;
  title?: string;
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
}

export interface SessionRef {
  cwd: string;
  sessionId: string;
  parentSessionId?: string;
  currentTurnId: number;
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
