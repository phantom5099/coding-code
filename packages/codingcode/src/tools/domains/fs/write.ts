import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname, relative } from 'path';
import type { ToolDefinition } from '../../types';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description:
    'Write content to a file. Creates parent directories if needed. Overwrites by default.',
  parameters: z.object({
    path: z.string().describe('Path to the file'),
    content: z.string().describe('Content to write'),
  }),
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  execute: async (args: unknown) => {
    const { path, content } = args as any;
    const filePath = resolve(path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    const relPath = relative(process.cwd(), filePath) || '.';
    return `File written: ${relPath} (${content.split('\n').length} lines, ${content.length} bytes)`;
  },
};
