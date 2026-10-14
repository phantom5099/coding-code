import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../util/error.js';
import type { ToolDefinition } from '../../types.js';
import { TodoService, formatTodoPlan } from '../../../todo/port.js';

export const todoReadTool: ToolDefinition<TodoService> = {
  name: 'todo_read',
  concurrencySafe: true,
  description:
    'Read the current task list. Use it before updating the plan whenever you are unsure of the list contents — e.g. after older tool results have been compacted away — so completed items are never dropped. Returns the full current list, or tells you the list is empty.',
  parameters: z.object({}),
  execute: (_args, ctx) =>
    Effect.gen(function* () {
      const todoSvc = yield* TodoService;
      const sessionId = ctx?.sessionId;
      if (!sessionId)
        return yield* Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', 'todo_read requires sessionId')
        );
      const plan = todoSvc.read(sessionId);
      return plan.length === 0 ? 'Todo list is empty.' : formatTodoPlan(plan);
    }),
};
