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

export type OverlayState =
  | { type: 'none' }
  | { type: 'model'; models: Array<{ id: string; name: string; provider: string; model: string }>; activeId: string }
  | { type: 'role'; roles: Array<{ id: string; label: string; description: string }>; currentRole: string }
  | { type: 'sessions'; sessions: SessionIndex[] }
  | { type: 'help' };
