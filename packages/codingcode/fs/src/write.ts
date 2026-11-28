import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, relative } from 'path';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { defineTool } from '@codingcode/tool';
import { resolveFileTarget } from '@codingcode/sandbox';

export const writeFileTool = defineTool({
  name: 'write_file',
  concurrencySafe: false,
  approval: { action: 'file', requiresConfirmation: true },
  describeOperation: (args) => ({
    action: 'file',
    requiresConfirmation: true,
    workspace: { paths: [args.path ?? ''], write: true },
  }),
  description:
    'Write content to a file, creating parent directories if needed. Overwrites existing files.',
  parameters: z.object({
    path: z.string().describe('Path to the file'),
    content: z.string().describe('Content to write'),
  }),
  execute: ({ path, content }, ctx) =>
    Effect.gen(function* () {
      if (!ctx?.session?.cwd || !ctx.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_PATH_DENIED', 'write_file requires a sandbox project path')
        );
      }
      const base = ctx.session.cwd;
      const filePath = yield* Effect.tryPromise({
        try: () => resolveFileTarget(ctx.sandboxPolicy!, { path, operation: 'write' }),
        catch: (error) =>
          error instanceof AgentError ? error : AgentError.toolExecutionFailed('write_file', error),
      });
      yield* Effect.tryPromise({
        try: () => mkdir(dirname(filePath), { recursive: true }),
        catch: (e) => AgentError.toolExecutionFailed('write_file', e),
      });
      yield* Effect.tryPromise({
        try: () => writeFile(filePath, content),
        catch: (e) => AgentError.toolExecutionFailed('write_file', e),
      });
      const relPath = relative(base, filePath) || '.';
      return `File written: ${relPath} (${content.split('\n').length} lines, ${content.length} bytes)`;
    }),
});
