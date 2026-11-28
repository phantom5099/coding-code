import type { ToolDefinition } from '@codingcode/tool';
import { readFileTool } from './read.js';
import { writeFileTool } from './write.js';
import { editFileTool } from './edit.js';
import { searchTool } from './grep.js';
import { globTool } from './glob.js';

export { readFileTool, writeFileTool, editFileTool, searchTool, globTool };

export const FS_TOOLS: readonly ToolDefinition<any, any>[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  searchTool,
  globTool,
];
