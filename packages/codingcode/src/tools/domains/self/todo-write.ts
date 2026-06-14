import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';
import {
  TodoService,
  countByStatus,
  TODO_MAX_ITEMS,
  TODO_MAX_STEP_LEN,
} from '../../../agent/todo.js';
import type { Todo } from '../../../agent/types.js';

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

export function createTodoWriteTool(): Effect.Effect<ToolDefinition, never, TodoService> {
  return Effect.gen(function* () {
    const todoSvc = yield* TodoService;

    return {
      name: 'todo_write',
      description:
        'Replace the current task list. Use for multi-step work to track plan and progress. Pass the full updated plan; previous list is replaced entirely.',
      shortDescription: 'Maintain task list for multi-step work',
      parameters: todoSchema,
      execute: (args, ctx) => {
        const sessionId = ctx?.sessionId;
        if (!sessionId)
          return Effect.fail(
            new AgentError('TOOL_EXECUTION_FAILED', 'todo_write requires sessionId')
          );
        const { plan } = args as { plan: Todo[] };
        todoSvc.write(sessionId, plan);
        const c = countByStatus(plan);
        return Effect.succeed(
          `pending=${c.pending} in_progress=${c.in_progress} completed=${c.completed}`
        );
      },
    };
  });
}
