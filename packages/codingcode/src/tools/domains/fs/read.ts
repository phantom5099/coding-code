import { z } from 'zod';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';

export const readFileTool: ToolDefinition = {
  name: 'read_file',
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
  execute: (args: unknown, ctx?: ToolExecCtx) =>
    Effect.gen(function* () {
      const { path, offset, limit } = args as any;
      const filePath = resolve(ctx?.projectPath ?? process.cwd(), path);
      const content = yield* Effect.tryPromise({
        try: () => readFile(filePath, 'utf-8'),
        catch: (e) => new AgentError('TOOL_EXECUTION_FAILED', String(e), e),
      });
      const lines = content.split('\n');
      const start = Math.max(0, offset - 1);
      const slice = lines.slice(start, start + limit);
      return (
        slice.map((line, i) => `${String(start + i + 1).padStart(4, ' ')}| ${line}`).join('\n') ||
        '(empty file)'
      );
    }),
};
