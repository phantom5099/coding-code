import { Effect } from 'effect';
import type { ToolDefinition } from './types.js';
import { ToolRegistry } from './registry.js';
import { readFileTool } from './domains/fs/read.js';
import { writeFileTool } from './domains/fs/write.js';
import { editFileTool } from './domains/fs/edit.js';
import { bashTool } from './domains/bash/exec.js';
import { searchTool } from './domains/fs/grep.js';
import { globTool } from './domains/fs/glob.js';
import { webFetchTool } from './domains/web/fetch.js';
import { webSearchTool } from './domains/web/search.js';
import { createTodoWriteTool } from './domains/self/todo-write.js';
import { TodoService } from '../agent/todo.js';

const STATELESS_BUILTIN_TOOLS: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  searchTool,
  globTool,
  webFetchTool,
  webSearchTool,
];

export function registerBuiltinTools(
  registry: ToolRegistry
): Effect.Effect<void, never, TodoService> {
  return Effect.gen(function* () {
    const todoTool = yield* createTodoWriteTool();
    registry.register(...STATELESS_BUILTIN_TOOLS, todoTool);
  });
}
