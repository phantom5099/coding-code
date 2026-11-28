import type { ToolDefinition } from '@codingcode/tool';
import { todoWriteTool } from './todo-write.js';
import { todoReadTool } from './todo-read.js';
import { askUserTool } from './ask-user.js';

export { todoWriteTool, todoReadTool, askUserTool };

export const SELF_TOOLS: readonly ToolDefinition<any, any>[] = [
  todoWriteTool,
  todoReadTool,
  askUserTool,
];
