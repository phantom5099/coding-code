export interface ToolDescription {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
  name?: string;
  usage?: { prompt: number; completion: number; total: number };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
