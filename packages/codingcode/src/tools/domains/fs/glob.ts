import { z } from 'zod';
import { globby } from 'globby';
import { relative } from 'path';
import { Effect } from 'effect';
import { AgentError } from '../../../util/error.js';
import type { ToolDefinition } from '../../types.js';
import { resolveFileTarget } from '../../../sandbox/file-boundary.js';

export const globTool: ToolDefinition = {
  name: 'search_files',
  concurrencySafe: true,
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
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const { pattern, path, max_results } = args as {
        pattern: string;
        path: string;
        max_results: number;
      };
      if (!ctx?.projectPath || !ctx.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_PATH_DENIED', 'search_files requires a sandbox project path')
        );
      }
      const base = ctx.projectPath;
      const basePath = yield* Effect.tryPromise({
        try: () => resolveFileTarget(ctx.sandboxPolicy!, path, 'read'),
        catch: (error) =>
          error instanceof AgentError
            ? error
            : AgentError.toolExecutionFailed('search_files', error),
      });

      const files = yield* Effect.tryPromise({
        try: () =>
          globby(pattern, {
            cwd: basePath,
            gitignore: true,
            ignore: ['node_modules/**', 'dist/**', '.git/**', '*.lockb', '*.lock', '*.min.js'],
            absolute: true,
            onlyFiles: true,
          }),
        catch: (e) => AgentError.toolExecutionFailed('search_files', e),
      });

      const safeFiles = yield* Effect.tryPromise({
        try: async () => {
          const checked: string[] = [];
          for (const file of files) {
            try {
              checked.push(await resolveFileTarget(ctx.sandboxPolicy!, file, 'read'));
            } catch {
              // A glob result outside the sandbox is omitted.
            }
          }
          return checked;
        },
        catch: (e) => AgentError.toolExecutionFailed('search_files', e),
      });
      const truncated = safeFiles.slice(0, max_results);
      const lines = truncated.map((f) => relative(base, f));

      if (safeFiles.length === 0) {
        return `No files matching "${pattern}" in ${relative(base, basePath) || '.'}`;
      }

      let out = `Found ${safeFiles.length} file(s) matching "${pattern}"`;
      if (safeFiles.length > max_results) {
        out += ` (showing first ${max_results})`;
      }
      return out + '\n' + lines.join('\n');
    }),
};
