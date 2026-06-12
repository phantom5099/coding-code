import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description:
    'Perform exact string replacement in a file. Provide the exact text to replace (old_string) and the new text (new_string). If old_string is not unique in the file, the edit will fail — narrow the match to make it unique.',
  parameters: z.object({
    path: z.string().describe('Path to the file to edit'),
    old_string: z
      .string()
      .min(1)
      .describe('Exact text to replace — must match exactly one location in the file'),
    new_string: z.string().describe('Text to replace it with'),
  }),
  execute: (args: unknown, ctx?: ToolExecCtx) =>
    Effect.gen(function* () {
      const { path, old_string, new_string } = args as {
        path: string;
        old_string: string;
        new_string: string;
      };
      const filePath = resolve(ctx?.projectPath ?? process.cwd(), path);
      const content = yield* Effect.tryPromise({
        try: () => readFile(filePath, 'utf-8'),
        catch: (e) => new AgentError('TOOL_EXECUTION_FAILED', String(e), e),
      });

      let idx = 0;
      let count = 0;
      let lastIdx = -1;

      while ((idx = content.indexOf(old_string, idx)) !== -1) {
        count++;
        lastIdx = idx;
        idx += old_string.length;
      }

      if (count === 0) {
        return `Error: old_string not found in ${path}. Verify the exact text to replace exists in the file.`;
      }

      if (count > 1) {
        return `Error: old_string appears ${count} times in ${path}. Make it unique by including more surrounding context so it matches exactly one location.`;
      }

      const newContent =
        content.slice(0, lastIdx) + new_string + content.slice(lastIdx + old_string.length);
      yield* Effect.tryPromise({
        try: () => writeFile(filePath, newContent),
        catch: (e) => new AgentError('TOOL_EXECUTION_FAILED', String(e), e),
      });

      const newLines = newContent.split('\n').length;
      return `File edited: ${path} — 1 replacement made (${newLines} lines, ${newContent.length} bytes)`;
    }),
};
