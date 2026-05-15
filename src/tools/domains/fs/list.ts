import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import { resolve, relative } from 'path';
import type { ToolDefinition } from '../../types';

export const listDirTool: ToolDefinition = {
  name: 'list_dir',
  description: 'List files and directories in a given path.',
  parameters: z.object({
    path: z.string().default('.').describe('Directory path (defaults to current directory)'),
  }),
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', default: '.', description: 'Directory path (defaults to current directory)' },
    },
  },
  execute: async (args: unknown) => {
    const { path } = args as any;
    const dirPath = resolve(path);
    const entries = await readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (e) => {
        try {
          const s = await stat(resolve(dirPath, e.name));
          const size = s.isFile() ? ` (${s.size} B)` : '';
          return `${e.isDirectory() ? 'DIR' : 'FILE'}  ${e.name}${size}`;
        } catch {
          return `${e.isDirectory() ? 'DIR' : 'FILE'}  ${e.name}`;
        }
      }),
    );
    return `Contents of ${relative(process.cwd(), dirPath) || '.'}:\n${items.join('\n')}`;
  },
};
