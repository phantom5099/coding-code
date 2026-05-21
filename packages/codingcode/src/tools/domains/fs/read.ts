import { z } from 'zod';
import { readFile } from 'fs/promises';
import type { ToolDefinition } from '../../types';
import { resolveInWorkspace } from '../../../core/workspace.js';

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file and return it with line numbers.',
  parameters: z.object({
    path: z.string().describe('Path to the file (absolute or relative)'),
    offset: z.number().int().min(1).default(1).describe('Line to start reading from (1-indexed)'),
    limit: z.number().int().min(1).max(500).default(200).describe('Maximum number of lines to read'),
  }),
  execute: async (args: unknown) => {
    const { path, offset, limit } = args as any;
    const filePath = resolveInWorkspace(path);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, offset - 1);
    const slice = lines.slice(start, start + limit);
    return (
      slice.map((line, i) => `${String(start + i + 1).padStart(4, ' ')}| ${line}`).join('\n') || '(empty file)'
    );
  },
};
