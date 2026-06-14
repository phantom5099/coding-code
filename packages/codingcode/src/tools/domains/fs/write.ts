import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, relative, resolve } from 'path';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description:
    'Write content to a file, creating parent directories if needed. Overwrites existing files.',
  parameters: z.object({
    path: z.string().describe('Path to the file'),
    content: z.string().describe('Content to write'),
  }),
  execute: (args: unknown, ctx?: ToolExecCtx) =>
    Effect.gen(function* () {
      const { path, content } = args as any;
      const base = ctx?.projectPath ?? process.cwd();
      const filePath = resolve(base, path);
      yield* Effect.tryPromise({
        try: () => mkdir(dirname(filePath), { recursive: true }),
        catch: (e) => new AgentError('TOOL_EXECUTION_FAILED', String(e), e),
      });
      yield* Effect.tryPromise({
        try: () => writeFile(filePath, content),
        catch: (e) => new AgentError('TOOL_EXECUTION_FAILED', String(e), e),
      });
      const relPath = relative(base, filePath) || '.';
      return `File written: ${relPath} (${content.split('\n').length} lines, ${content.length} bytes)`;
    }),
};
