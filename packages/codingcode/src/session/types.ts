import type { MediaPart, TextPart, TokenUsage, ToolCall } from '../llm/types.js';
import type { ProfileName, PermissionMode } from '../util/enums.js';

/**
 * 落盘形态的媒体块：MediaPart 之上附物化时解析出的元数据。
 *
 */
export interface StoredMediaPart extends MediaPart {
  /** 原始字节数；UI 展示体积、PDF 的 token 估算用 */
  bytes: number;
  /** 仅图片：服务端从文件头读出 */
  width?: number;
  height?: number;
  /** 仅音频：服务端从容器头读出，token 估算用 */
  durationSec?: number;
}

/** 落盘形态的内容块：转录事件与 UI 转通用。 */
export type StoredPart = TextPart | StoredMediaPart;

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
  /**
   * 本会话的祖先链，由近及远，末位是顶层主会话；完整链路 = [sessionId, ...parentChain]。
   * 仅子会话写入。子智能体转录统一挂在链末位的 subagents/ 下，故链同时是路径定位依据。
   */
  parentChain?: string[];
  /** 子智能体用途描述；首次派发时给出，供 list_agents 展示 */
  description?: string;
  /** 子会话自定义 system prompt 中间段；仅子会话写入，续跑时回读，缺省回落 profile */
  systemPrompt?: string;
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

export const SUBAGENT_MESSAGE_PREFIX = 'Message Type: INTER_AGENT_MESSAGE';

export interface SubagentMessageEvent {
  type: 'subagent_message';
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
  | SubagentResultEvent
  | SubagentMessageEvent;

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
  /** 本会话的祖先链，由近及远；转录定位用，见 session/paths.ts */
  parentChain?: readonly string[];
  currentTurnId: number;
}

export type UITurnItem =
  | {
      id: string;
      type: 'message';
      role: 'user' | 'assistant';
      parts: StoredPart[];
      partial?: boolean;
    }
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
