import { z } from 'zod';
import { globby } from 'globby';
import { readFile } from 'fs/promises';
import { relative } from 'path';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { defineTool } from '@codingcode/tool';
import { resolveFileTarget } from '@codingcode/sandbox';

export const searchTool = defineTool({
  name: 'search_code',
  concurrencySafe: true,
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
  execute: ({ pattern, glob, max_results }, ctx) =>
    Effect.gen(function* () {
      if (!ctx?.session?.cwd || !ctx.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_PATH_DENIED', 'search_code requires a sandbox project path')
        );
      }
      const base = ctx.session.cwd;
      yield* Effect.tryPromise({
        try: () => resolveFileTarget(ctx.sandboxPolicy!, { path: '.', operation: 'read' }),
        catch: (error) =>
          error instanceof AgentError
            ? error
            : AgentError.toolExecutionFailed('search_code', error),
      });
      const files = yield* Effect.tryPromise({
        try: () =>
          globby(glob, {
            cwd: base,
            gitignore: true,
            ignore: ['node_modules/**', 'dist/**', '.git/**', '*.lockb', '*.lock', '*.min.js'],
            absolute: true,
          }),
        catch: (e) => AgentError.toolExecutionFailed('search_code', e),
      });

      const safeFiles = yield* Effect.tryPromise({
        try: async () => {
          const checked: string[] = [];
          for (const file of files) {
            try {
              checked.push(
                await resolveFileTarget(ctx.sandboxPolicy!, { path: file, operation: 'read' })
              );
            } catch {
              // A glob result outside the sandbox is omitted.
            }
          }
          return checked;
        },
        catch: (e) => AgentError.toolExecutionFailed('search_code', e),
      });
      const filesToScan = safeFiles.slice(0, 200);
      const results: string[] = [];
      const regex = new RegExp(pattern, 'gi');

      for (const file of filesToScan) {
        if (results.length >= max_results) break;
        const contentResult = yield* Effect.either(
          Effect.tryPromise({
            try: () => readFile(file, 'utf-8'),
            catch: (e) => AgentError.toolExecutionFailed('search_code', e),
          })
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

      if (results.length === 0)
        return `No matches for "${pattern}" in ${filesToScan.length} files.`;
      return `Found ${results.length} matches for "${pattern}":\n${results.join('\n')}`;
    }),
});
