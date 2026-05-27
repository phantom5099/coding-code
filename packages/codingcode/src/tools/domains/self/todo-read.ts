import { z } from 'zod';
import { AgentError } from '../../../core/error';
import type { ToolDefinition } from '../../types';
import { sharedTodoStore } from '../../../self/todo';

export const todoReadTool: ToolDefinition = {
  name: 'todo_read',
  description: 'Read the current task list. Returns in_progress items first, then pending, completed last.',
  shortDescription: 'Read current task list',
  deferred: true,
  parameters: z.object({}),
  execute: async (_args, ctx) => {
    const sessionId = ctx?.sessionId;
    if (!sessionId) throw new AgentError('TOOL_EXECUTION_FAILED', 'todo_read requires sessionId');
    const plan = sharedTodoStore.read(sessionId);
    if (plan.length === 0) return '(empty)';
    const inProgress = plan.filter(t => t.status === 'in_progress').map(t => `> ${t.step}`);
    const pending = plan.filter(t => t.status === 'pending').map(t => `- ${t.step}`);
    const completed = plan.filter(t => t.status === 'completed').map(t => `+ ${t.step}`);
    return [...inProgress, ...pending, ...completed].join('\n');
  },
};
