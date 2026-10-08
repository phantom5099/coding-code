export type ProfileName = 'plan' | 'build';

export type PermissionMode = 'askBeforeExec' | 'bypass';

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  step: string;
  status: TodoStatus;
}
