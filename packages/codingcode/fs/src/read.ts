import { z } from 'zod';
import { readFile } from 'fs/promises';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { defineTool } from '@codingcode/tool';
import { resolveFileTarget } from '@codingcode/sandbox';

export const readFileTool = defineTool({
  name: 'read_file',
  concurrencySafe: true,
  description: 'Read the contents of a file and return it with line numbers.',
  parameters: z.object({
    path: z.string().describe('Path to the file (absolute or relative)'),
    offset: z.number().int().min(1).default(1).describe('Line to start reading from (1-indexed)'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(200)
      .describe('Maximum number of lines to read'),
  }),
  execute: ({ path, offset, limit }, ctx) =>
    Effect.gen(function* () {
      if (!ctx?.session?.cwd || !ctx.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_PATH_DENIED', 'read_file requires a sandbox project path')
        );
      }
      const filePath = yield* Effect.tryPromise({
        try: () => resolveFileTarget(ctx.sandboxPolicy!, { path, operation: 'read' }),
        catch: (error) =>
          error instanceof AgentError ? error : AgentError.toolExecutionFailed('read_file', error),
      });
      const content = yield* Effect.tryPromise({
        try: () => readFile(filePath, 'utf-8'),
        catch: (e) => AgentError.toolExecutionFailed('read_file', e),
      });
      const lines = content.split('\n');
      const start = Math.max(0, offset - 1);
      const slice = lines.slice(start, start + limit);
      return (
        slice.map((line, i) => `${String(start + i + 1).padStart(4, ' ')}| ${line}`).join('\n') ||
        '(empty file)'
      );
    }),
});
