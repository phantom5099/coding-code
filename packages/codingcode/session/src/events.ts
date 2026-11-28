import type { MediaPart, ReasoningData, TextPart, TokenUsage, ToolCall } from '@codingcode/model';
import type { SessionMeta, TurnRange } from './types.js';

/** 落盘形态的媒体块：MediaPart 之上附物化时解析出的元数据 */
export interface StoredMediaPart extends MediaPart {
  bytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
}

/** 落盘形态的内容块：转录事件与 UI 投影共用 */
export type StoredPart = TextPart | StoredMediaPart;

export interface SessionMetaEvent extends SessionMeta {
  type: 'session_meta';
}

export interface UserEvent {
  type: 'user';
  turnId: number;
  content: StoredPart[];
  source?: 'user' | 'system';
}

export interface AssistantEvent {
  type: 'assistant';
  turnId: number;
  content: string;
  reasoning?: ReasoningData;
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

export interface SummaryEvent extends TurnRange {
  type: 'summary';
  uuid: string;
  summaryText: string;
}

export interface RollbackEvent {
  type: 'rollback';
  throughTurnId: number;
  reason: string;
}

export interface CompactEvent extends TurnRange {
  type: 'compact';
  uuid: string;
}

export const SUBAGENT_RESULT_PREFIX = 'Message Type: FINAL_ANSWER';
export const SUBAGENT_MESSAGE_PREFIX = 'Message Type: INTER_AGENT_MESSAGE';

export interface SubagentEnvelope {
  uuid: string;
  sessionId: string;
  agentName: string;
  content: string;
}

export interface SubagentResultEvent extends SubagentEnvelope {
  type: 'subagent_result';
}

export interface SubagentMessageEvent extends SubagentEnvelope {
  type: 'subagent_message';
}

export type TurnScopedEvent = UserEvent | AssistantEvent | ToolResultEvent;
export type UuidScopedEvent =
  | SummaryEvent
  | CompactEvent
  | SubagentResultEvent
  | SubagentMessageEvent;

export type SessionEvent =
  | SessionMetaEvent
  | TurnScopedEvent
  | RollbackEvent
  | UuidScopedEvent;

export function isTurnScopedEvent(event: SessionEvent): event is TurnScopedEvent {
  return event.type === 'user' || event.type === 'assistant' || event.type === 'tool_result';
}

export function isUuidScopedEvent(event: SessionEvent): event is UuidScopedEvent {
  return (
    event.type === 'summary' ||
    event.type === 'compact' ||
    event.type === 'subagent_result' ||
    event.type === 'subagent_message'
  );
}
