import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';
import type { ToolVisibilityPolicy } from '../../types.js';
import { ToolSearchService } from '../../tool-search-service.js';

export function createToolSearchTool(
  policy?: ToolVisibilityPolicy
): Effect.Effect<ToolDefinition, never, ToolSearchService> {
  return Effect.gen(function* () {
    const searchSvc = yield* ToolSearchService;

    return {
      name: 'tool_search',
      description:
        'Load deferred tools by keyword search. Required before calling any deferred tool — match the tool name or description with relevant keywords.',
      parameters: z.object({
        query: z
          .string()
          .min(1)
          .describe('Keywords to match against deferred tool names and descriptions.'),
      }),
      execute: (args, ctx) => {
        const sessionId = ctx?.sessionId;
        if (!sessionId)
          return Effect.fail(
            new AgentError('TOOL_EXECUTION_FAILED', 'tool_search requires sessionId')
          );
        const { query } = args as { query: string };
        const hits = searchSvc.search(sessionId, query, policy);
        if (hits.length === 0) return Effect.succeed(`No deferred tools matched "${query}".`);
        searchSvc.markLoaded(
          sessionId,
          hits.map((h) => h.name)
        );
        return Effect.succeed(
          [
            `Loaded ${hits.length} tool(s). Their full schemas are now available next turn:`,
            ...hits.map((h) => `- ${h.name}: ${h.shortDescription ?? ''}`),
          ].join('\n')
        );
      },
    };
  });
}
