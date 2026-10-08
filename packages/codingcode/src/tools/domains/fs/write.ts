import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, relative, resolve } from 'path';
import { Effect } from 'effect';
import { AgentError } from '../../../util/error.js';
import type { ToolDefinition } from '../../types.js';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  concurrencySafe: false,
  description:
    'Write content to a file, creating parent directories if needed. Overwrites existing files.',
  parameters: z.object({
    path: z.string().describe('Path to the file'),
    content: z.string().describe('Content to write'),
  }),
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const { path, content } = args as any;
      const base = ctx?.projectPath ?? process.cwd();
      const filePath = resolve(base, path);
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
