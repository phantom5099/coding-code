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
  role: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface PanelItem<T = string> {
  label: string;
  value: T;
  description?: string;
}

export type PanelState =
  | { type: 'none' }
  | { type: 'model'; items: PanelItem[]; activeValue: string }
  | { type: 'role'; items: PanelItem[]; activeValue: string }
  | { type: 'sessions'; items: PanelItem[] }
  | { type: 'help' };
