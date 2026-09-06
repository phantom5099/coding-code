export type StreamChunk =
  | { type: 'session_id'; sessionId: string }
  | { type: 'turn_id'; turnId: number }
  | { type: 'text'; text: string; messageId?: number }
  | { type: 'message'; id: number; content: string; partial: false }
  | {
      type: 'approval_request';
      id: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | { type: 'plan_ready'; sessionId: string; title: string }
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; output: string; ok: boolean }
  | { type: 'tool_denied'; id: string; name: string; reason: string }
  | { type: 'error'; message: string; code: string }
  | { type: 'done' }
  | { type: 'todo_update'; items: ReadonlyArray<{ step: string; status: string }> }
  | { type: 'context_compressed'; released: number; promptEstimate: number }
  | { type: 'usage'; prompt: number; completion: number; total: number };
