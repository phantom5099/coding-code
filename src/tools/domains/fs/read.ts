import { z } from 'zod';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { ToolDefinition } from '../../types';

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description:
    'Read the contents of a file with line numbers. Use this before modifying any file.',
  parameters: z.object({
    path: z.string().describe('Path to the file (absolute or relative)'),
    offset: z.number().int().min(1).default(1).describe('Line to start from (1-indexed)'),
    limit: z.number().int().min(1).max(500).default(200).describe('Max lines to read'),
  }),
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file (absolute or relative)' },
      offset: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
    },
    required: ['path'],
  },
  execute: async (args: unknown) => {
    const { path, offset, limit } = args as any;
    const filePath = resolve(path);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, offset - 1);
    const slice = lines.slice(start, start + limit);
    return (
      slice.map((line, i) => `${String(start + i + 1).padStart(4, ' ')}| ${line}`).join('\n') || '(empty file)'
    );
  },
};
