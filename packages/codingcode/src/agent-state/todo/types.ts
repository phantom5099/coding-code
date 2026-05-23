export type TodoStatus = 'pending' | 'completed' | 'cancelled';

export interface Todo {
  step: string;
  status: TodoStatus;
}

export const TODO_MAX_ITEMS = 20;
export const TODO_MAX_STEP_LEN = 60;
