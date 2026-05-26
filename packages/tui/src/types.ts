export interface UIMessage {
  id: string;
  timestamp: number;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'welcome';
  content: string;
  isStreaming?: boolean;
  model?: string;
  toolName?: string;
}

export interface SessionIndex {
  sessionId: string;
  projectSlug: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface PanelItem<T = string> {
  label: string;
  value: T;
  description?: string;
}

export interface CheckpointInfo {
  turnId: number;
  title: string;
  agentModified: string[];
  unknownSource: string[];
}

export interface McpServerStatus {
  name: string;
  connected: boolean;
  disabled: boolean;
  toolCount: number;
  transport: 'stdio' | 'http';
  reconnectAttempts: number;
}

export interface SkillStatus {
  name: string;
  description: string;
  enabled: boolean;
}

export type PanelState =
  | { type: 'none' }
  | { type: 'model'; items: PanelItem[]; activeValue: string }
  | { type: 'sessions'; items: PanelItem[] }
  | { type: 'approval'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'checkpoint-list'; checkpoints: CheckpointInfo[] }
  | { type: 'checkpoint-action'; cp: CheckpointInfo; hasForward: boolean }
  | { type: 'help' }
  | { type: 'mcp'; servers: McpServerStatus[] }
  | { type: 'skill'; skills: SkillStatus[] }
  | { type: 'permission'; currentMode: string };
