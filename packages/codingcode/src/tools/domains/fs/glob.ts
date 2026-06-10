import { z } from 'zod';
import { globby } from 'globby';
import { relative, resolve } from 'path';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';

export const globTool: ToolDefinition = {
  name: 'search_files',
  description:
    'Find files matching a glob pattern. Returns file paths sorted by modification time (newest first). Useful for locating files by name or extension across the project.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern to match files, e.g. "**/*.ts", "src/**/*.tsx"'),
    path: z
      .string()
      .default('.')
      .describe('Base directory for the search (default: current working directory)'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .describe('Maximum number of file paths to return'),
  }),
  execute: async (args: unknown, ctx?: ToolExecCtx) => {
    const { pattern, path, max_results } = args as {
      pattern: string;
      path: string;
      max_results: number;
    };
    const base = ctx?.projectPath ?? process.cwd();
    const basePath = resolve(base, path);

    const files = await globby(pattern, {
      cwd: basePath,
      gitignore: true,
      ignore: ['node_modules/**', 'dist/**', '.git/**', '*.lockb', '*.lock', '*.min.js'],
      absolute: true,
      onlyFiles: true,
    });

    const truncated = files.slice(0, max_results);
    const lines = truncated.map((f) => relative(base, f));

    if (files.length === 0) {
      return `No files matching "${pattern}" in ${relative(base, basePath) || '.'}`;
    }

    let out = `Found ${files.length} file(s) matching "${pattern}"`;
    if (files.length > max_results) {
      out += ` (showing first ${max_results})`;
    }
    return out + '\n' + lines.join('\n');
  },
};
