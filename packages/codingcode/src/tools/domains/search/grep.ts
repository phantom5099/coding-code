import { z } from 'zod';
import { globby } from 'globby';
import { readFile } from 'fs/promises';
import { relative } from 'path';
import type { ToolDefinition } from '../../types';

export const searchTool: ToolDefinition = {
  name: 'search_code',
  description:
    'Search for a text or regex pattern in project files. Returns matching file paths and line content. Use to find where functions, types, or patterns are defined.',
  parameters: z.object({
    pattern: z.string().describe('Text or regex pattern to search for'),
    glob: z.string().default('**/*').describe("File glob pattern (e.g. 'src/**/*.ts')"),
    max_results: z.number().int().min(1).max(100).default(30).describe('Max matches to return'),
  }),
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Text or regex pattern to search for' },
      glob: { type: 'string', default: '**/*', description: "File glob pattern (e.g. 'src/**/*.ts')" },
      max_results: { type: 'integer', minimum: 1, maximum: 100, default: 30, description: 'Max matches to return' },
    },
    required: ['pattern'],
  },
  execute: async (args: unknown) => {
    const { pattern, glob, max_results } = args as any;
    const files = await globby(glob, {
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
            const relPath = relative(process.cwd(), file);
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
