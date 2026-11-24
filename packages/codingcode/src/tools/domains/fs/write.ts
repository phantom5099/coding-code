import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, relative } from 'path';
import { Effect } from 'effect';
import { AgentError } from '../../../util/error.js';
import type { ToolDefinition } from '../../types.js';
import { resolveFileTarget } from '../../../sandbox/file-boundary.js';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  concurrencySafe: false,
  approval: { action: 'file', requiresConfirmation: true },
  describeOperation: (args) => ({
    action: 'file',
    requiresConfirmation: true,
    workspace: { paths: [String((args as { path?: unknown }).path ?? '')], write: true },
  }),
  description:
    'Write content to a file, creating parent directories if needed. Overwrites existing files.',
  parameters: z.object({
    path: z.string().describe('Path to the file'),
    content: z.string().describe('Content to write'),
  }),
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const { path, content } = args as any;
      if (!ctx?.projectPath || !ctx.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_PATH_DENIED', 'write_file requires a sandbox project path')
        );
      }
      const base = ctx.projectPath;
      const filePath = yield* Effect.tryPromise({
        try: () => resolveFileTarget(ctx.sandboxPolicy!, path, 'write'),
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
};
