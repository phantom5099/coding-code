export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  step: string;
  status: TodoStatus;
}
