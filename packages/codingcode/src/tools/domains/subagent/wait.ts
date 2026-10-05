import { z } from 'zod';
import { Effect } from 'effect';
import type { ToolDefinition } from '../../types.js';
import {
  SubagentRunRegistryService,
  SUBAGENT_WAIT_DEFAULT_MS,
  SUBAGENT_WAIT_MIN_MS,
  SUBAGENT_WAIT_MAX_MS,
} from '../../../subagent/registry.js';

export const waitAgentTool: ToolDefinition<SubagentRunRegistryService> = {
  name: 'wait_agent',
  concurrencySafe: true,
  description:
    'Wait until a subagent reaches a terminal state. Returns completed, failed or timeout. '
    + 'The subagent final output is appended to this conversation automatically — never use this tool to fetch text, '
    + 'and only wait when the result blocks your next step. Do not poll with short timeouts.',
  parameters: z.object({
    sessionId: z.string().min(1).describe('subagent session id returned by spawn_agent'),
    timeoutMs: z.number().int().positive().optional().describe('upper bound for this wait, clamped to [10000, 3600000]; default 30000'),
  }),
  execute: (args, _ctx) =>
    Effect.gen(function* () {
      const registry = yield* SubagentRunRegistryService;
      const { sessionId, timeoutMs } = args as { sessionId: string; timeoutMs?: number };
      const clamped = Math.min(Math.max(timeoutMs ?? SUBAGENT_WAIT_DEFAULT_MS, SUBAGENT_WAIT_MIN_MS), SUBAGENT_WAIT_MAX_MS);
      const outcome = yield* registry.wait(sessionId, clamped);
      return outcome;
    }),
};
