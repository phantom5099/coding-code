import { z } from 'zod';
import { globby } from 'globby';
import { readFile } from 'fs/promises';
import { relative, resolve } from 'path';
import type { ToolDefinition, ToolExecCtx } from '../../types';

export const searchTool: ToolDefinition = {
  name: 'search_code',
  description:
    'Search for a text or regex pattern in project files and return matching file paths and line content.',
  parameters: z.object({
    pattern: z.string().describe('Text or regex pattern to search for'),
    glob: z
      .string()
      .default('**/*')
      .describe("File glob pattern to filter which files to search (e.g. 'src/**/*.ts')"),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .describe('Maximum number of matches to return'),
  }),
  execute: async (args: unknown, ctx?: ToolExecCtx) => {
    const { pattern, glob, max_results } = args as any;
    const base = ctx?.projectPath ?? process.cwd();
    const files = await globby(glob, {
      cwd: base,
      gitignore: true,
      ignore: ['node_modules/**', 'dist/**', '.git/**', '*.lockb', '*.lock', '*.min.js'],
      absolute: true,
    });

    const filesToScan = files.slice(0, 200);
    const results: string[] = [];
    const regex = new RegExp(pattern, 'gi');

    for (const file of filesToScan) {
      if (results.length >= max_results) break;
      try {
        const content = await readFile(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < max_results; i++) {
          const line = lines[i];
          if (line && regex.test(line)) {
            const relPath = relative(base, file);
            results.push(`${relPath}:${i + 1}: ${line.trim().slice(0, 120)}`);
          }
        }
      } catch {
        /* skip unreadable */
      }
    }

    if (results.length === 0) return `No matches for "${pattern}" in ${filesToScan.length} files.`;
    return `Found ${results.length} matches for "${pattern}":\n${results.join('\n')}`;
  },
};
