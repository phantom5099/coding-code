import { z } from 'zod';
import { AgentError } from '../../../core/error';
import type { ToolDefinition } from '../../types';
import { sharedTodoStore, countByStatus, TODO_MAX_ITEMS, TODO_MAX_STEP_LEN, type Todo } from '../../../self/todo';

const todoSchema = z.object({
  plan: z.array(z.object({
    step: z.string().min(1).max(TODO_MAX_STEP_LEN),
    status: z.enum(['pending', 'in_progress', 'completed']),
  })).max(TODO_MAX_ITEMS),
});

export const todoWriteTool: ToolDefinition = {
  name: 'todo_write',
  description: 'Replace the current task list. Use for multi-step work to track plan and progress. Pass the full updated plan; previous list is replaced entirely.',
  shortDescription: 'Maintain task list for multi-step work',
  deferred: true,
  parameters: todoSchema,
  execute: async (args, ctx) => {
    const agentId = ctx?.agentId;
    if (!agentId) throw new AgentError('TOOL_EXECUTION_FAILED', 'todo_write requires agentId');
    const { plan } = args as { plan: Todo[] };
    sharedTodoStore.write(agentId, plan);
    const c = countByStatus(plan);
    return `pending=${c.pending} in_progress=${c.in_progress} completed=${c.completed}`;
  },
};
