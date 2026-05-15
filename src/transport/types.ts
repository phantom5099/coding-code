export interface UserRequest {
  sessionId: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AgentResponse {
  sessionId: string;
  message: string;
  status: 'thinking' | 'tool_calling' | 'complete' | 'error';
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

export interface Transport {
  readonly mode: 'stdio' | 'websocket' | 'sdk';
  recv(): Promise<UserRequest>;
  send(response: AgentResponse): Promise<void>;
  sendStream(chunk: string): Promise<void>;
  onCancel?(handler: () => void): void;
  close(): Promise<void>;
}
