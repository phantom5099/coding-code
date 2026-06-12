import { z } from 'zod';
import { globby } from 'globby';
import { readFile } from 'fs/promises';
import { relative, resolve } from 'path';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';

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
  execute: (args: unknown, ctx?: ToolExecCtx) =>
    Effect.gen(function* () {
      const { pattern, glob, max_results } = args as any;
      const base = ctx?.projectPath ?? process.cwd();
      const files = yield* Effect.tryPromise({
        try: () =>
          globby(glob, {
            cwd: base,
            gitignore: true,
            ignore: ['node_modules/**', 'dist/**', '.git/**', '*.lockb', '*.lock', '*.min.js'],
            absolute: true,
          }),
        catch: (e) => new AgentError('TOOL_EXECUTION_FAILED', String(e), e),
      });

      const filesToScan = files.slice(0, 200);
      const results: string[] = [];
      const regex = new RegExp(pattern, 'gi');

      for (const file of filesToScan) {
        if (results.length >= max_results) break;
        const contentResult = yield* Effect.either(
          Effect.tryPromise({
            try: () => readFile(file, 'utf-8'),
            catch: (e) => new AgentError('TOOL_EXECUTION_FAILED', String(e), e),
          }),
        );
        if (contentResult._tag === 'Left') continue;
        const content = contentResult.right;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < max_results; i++) {
          const line = lines[i];
          if (line && regex.test(line)) {
            const relPath = relative(base, file);
            results.push(`${relPath}:${i + 1}: ${line.trim().slice(0, 120)}`);
          }
        }
      }

      if (results.length === 0) return `No matches for "${pattern}" in ${filesToScan.length} files.`;
      return `Found ${results.length} matches for "${pattern}":\n${results.join('\n')}`;
    }),
};
