import { z } from 'zod';
import { Effect } from 'effect';
import type { ToolDefinition } from '../../types.js';
import { AgentError } from '../../../util/error.js';
import { TurnRegistryService } from '../../../turn/port.js';

export const SUBAGENT_WAIT_MIN_MS = 10_000;
export const SUBAGENT_WAIT_DEFAULT_MS = 30_000;
export const SUBAGENT_WAIT_MAX_MS = 3_600_000;

export const waitAgentTool: ToolDefinition<TurnRegistryService> = {
  name: 'wait_agent',
  concurrencySafe: true,
  description:
    'Wait until a subagent reaches a terminal state. Returns completed, failed or timeout. ' +
    'The subagent final output is appended to this conversation automatically — never use this tool to fetch text, ' +
    'and only wait when the result blocks your next step. Do not poll with short timeouts.',
  parameters: z.object({
    sessionId: z.string().min(1).describe('subagent session id returned by spawn_agent'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('upper bound for this wait, clamped to [10000, 3600000]; default 30000'),
  }),
  execute: (args, _ctx) =>
    Effect.gen(function* () {
      const turn = yield* TurnRegistryService;
      const { sessionId, timeoutMs } = args as { sessionId: string; timeoutMs?: number };
      const clamped = Math.min(
        Math.max(timeoutMs ?? SUBAGENT_WAIT_DEFAULT_MS, SUBAGENT_WAIT_MIN_MS),
        SUBAGENT_WAIT_MAX_MS
      );
      const outcome = yield* turn.wait(sessionId, clamped);
      if (outcome === undefined) {
        return yield* Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', `Unknown subagent: ${sessionId}`)
        );
      }
      return outcome;
    }),
};
