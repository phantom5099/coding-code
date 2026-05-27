import { z } from 'zod';
import { AgentError } from '../../../core/error';
import type { ToolDefinition } from '../../types';

export interface ToolSearchApi {
  search: (sessionId: string, query: string) => Array<{ name: string; shortDescription?: string }>;
}

export function createToolSearchTool(svc: ToolSearchApi): ToolDefinition {
  return {
    name: 'tool_search',
    description: 'Load deferred tools by keyword search. Required before calling any deferred tool — match the tool name or description with relevant keywords.',
    parameters: z.object({
      query: z.string().min(1).describe('Keywords to match against deferred tool names and descriptions.'),
    }),
    execute: async (args, ctx) => {
      const sessionId = ctx?.sessionId;
      if (!sessionId) throw new AgentError('TOOL_EXECUTION_FAILED', 'tool_search requires sessionId');
      const { query } = args as { query: string };
      const hits = svc.search(sessionId, query);
      if (hits.length === 0) return `No deferred tools matched "${query}".`;
      return [
        `Loaded ${hits.length} tool(s). Their full schemas are now available next turn:`,
        ...hits.map(h => `- ${h.name}: ${h.shortDescription ?? ''}`),
      ].join('\n');
    },
  };
}
