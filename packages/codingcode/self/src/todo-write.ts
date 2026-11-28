import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { defineTool } from '@codingcode/tool';
import {
  TodoService,
  formatTodoPlan,
  TODO_MAX_ITEMS,
  TODO_MAX_STEP_LEN,
} from '@codingcode/todo';

const todoSchema = z.object({
  plan: z
    .array(
      z.object({
        step: z.string().min(1).max(TODO_MAX_STEP_LEN),
        status: z.enum(['pending', 'in_progress', 'completed']),
      })
    )
    .max(TODO_MAX_ITEMS),
});

export const todoWriteTool = defineTool<TodoService, typeof todoSchema>({
  name: 'todo_write',
  concurrencySafe: true,
  description:
    'Replace the current task list. Use for multi-step work to track plan and progress. Pass the full updated plan; previous list is replaced entirely. Returns the full current list after writing — treat it as ground truth for your next update.',
  parameters: todoSchema,
  execute: ({ plan }, ctx) =>
    Effect.gen(function* () {
      const todoSvc = yield* TodoService;
      const sessionId = ctx?.session?.sessionId;
      if (!sessionId)
        return yield* Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', 'todo_write requires sessionId')
        );
      todoSvc.write(sessionId, plan);
      return formatTodoPlan(plan);
    }),
});
