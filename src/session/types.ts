/** 会话事件类型 */
export type SessionEventType =
  | "session_meta"
  | "user"
  | "assistant"
  | "tool_result"
  | "role_switch"
  | "compact_boundary";

/** 工具调用描述 */
export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** session_meta — 始终为首行 */
export interface SessionMetaEvent {
  type: "session_meta";
  sessionId: string;
  projectSlug: string;
  cwd: string;
  model: string;
  role: string;
  createdAt: string;
  version: string;
}

/** user — 用户输入 */
export interface UserEvent {
  type: "user";
  uuid: string;
  content: string;
  timestamp: string;
}

/** assistant — 助手回复 */
export interface AssistantEvent {
  type: "assistant";
  uuid: string;
  content: string;
  toolCalls?: ToolCallRecord[];
  model: string;
  timestamp: string;
}

/** tool_result — 工具执行结果 */
export interface ToolResultEvent {
  type: "tool_result";
  uuid: string;
  parentUuid: string;
  toolName: string;
  toolCallId: string;
  output: string;
  timestamp: string;
}

/** role_switch — 角色切换 */
export interface RoleSwitchEvent {
  type: "role_switch";
  uuid: string;
  fromRole: string;
  toRole: string;
  timestamp: string;
}

/** compact_boundary — 压缩标记 */
export interface CompactBoundaryEvent {
  type: "compact_boundary";
  uuid: string;
  summary: string;
  replacedRange: [number, number];
  messageCount: number;
  timestamp: string;
}

/** 所有事件的联合类型 */
export type SessionEvent =
  | SessionMetaEvent
  | UserEvent
  | AssistantEvent
  | ToolResultEvent
  | RoleSwitchEvent
  | CompactBoundaryEvent;

/** 索引条目 */
export interface SessionIndex {
  sessionId: string;
  projectSlug: string;
  cwd: string;
  model: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
