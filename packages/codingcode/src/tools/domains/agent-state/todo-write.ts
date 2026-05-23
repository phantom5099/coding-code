import { z } from 'zod';
import { AgentError } from '../../../core/error';
import type { ToolDefinition } from '../../types';
import { sharedTodoStore, countByStatus } from '../../../agent-state/todo/service';
import { TODO_MAX_ITEMS, TODO_MAX_STEP_LEN, type Todo } from '../../../agent-state/todo/types';

const todoSchema = z.object({
  plan: z.array(z.object({
    step: z.string().min(1).max(TODO_MAX_STEP_LEN),
    status: z.enum(['pending', 'completed', 'cancelled']),
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
    return `pending=${c.pending} completed=${c.completed} cancelled=${c.cancelled}`;
  },
};
