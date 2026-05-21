import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, relative } from 'path';
import type { ToolDefinition } from '../../types';
import { getWorkspaceCwd, resolveInWorkspace } from '../../../core/workspace.js';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file, creating parent directories if needed. Overwrites existing files.',
  parameters: z.object({
    path: z.string().describe('Path to the file'),
    content: z.string().describe('Content to write'),
  }),
  execute: async (args: unknown) => {
    const { path, content } = args as any;
    const filePath = resolveInWorkspace(path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    const relPath = relative(getWorkspaceCwd(), filePath) || '.';
    return `File written: ${relPath} (${content.split('\n').length} lines, ${content.length} bytes)`;
  },
};
