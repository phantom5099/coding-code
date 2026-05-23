import { z } from 'zod';
import { AgentError } from '../../../core/error';
import type { ToolDefinition } from '../../types';
import { sharedTodoStore } from '../../../agent-state/todo';

export const todoReadTool: ToolDefinition = {
  name: 'todo_read',
  description: 'Read the current task list. Returns pending items first, completed items last. Cancelled items are not returned.',
  shortDescription: 'Read current task list',
  deferred: true,
  parameters: z.object({}),
  execute: async (_args, ctx) => {
    const agentId = ctx?.agentId;
    if (!agentId) throw new AgentError('TOOL_EXECUTION_FAILED', 'todo_read requires agentId');
    const plan = sharedTodoStore.read(agentId);
    const visible = plan.filter(t => t.status !== 'cancelled');
    if (visible.length === 0) return '(empty)';
    const pending = visible.filter(t => t.status === 'pending').map(t => `- ${t.step}`);
    const completed = visible.filter(t => t.status === 'completed').map(t => `+ ${t.step}`);
    return [...pending, ...completed].join('\n');
  },
};
