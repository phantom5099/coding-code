export interface UIMessage {
  id: string;
  timestamp: number;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'welcome';
  content: string;
  isStreaming?: boolean;
  model?: string;
  toolName?: string;
}

export type OverlayState =
  | { type: 'none' }
  | { type: 'model'; models: import('../../llm/factory').SelectableModel[]; activeId: string }
  | { type: 'role'; roles: Array<{ id: string; label: string; description: string }>; currentRole: string }
  | { type: 'sessions'; sessions: import('../../session/types').SessionIndex[] }
  | { type: 'help' };
