export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
}

export interface AssistantMessage extends Message {
  role: 'assistant';
  tool_calls?: ToolCall[];
}

export interface ToolMessage extends Message {
  role: 'tool';
  tool_call_id: string;
  tool_name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDescription {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
