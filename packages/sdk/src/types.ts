export type PermissionMode = 'askBeforeExec' | 'bypass' | 'unrestricted';

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  reasoningTokens?: number;
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  step: string;
  status: TodoStatus;
}
