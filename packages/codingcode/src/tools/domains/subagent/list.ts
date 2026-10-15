import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../util/error.js';
import type { ToolDefinition } from '../../types.js';
import { TurnRegistryService } from '../../../turn/port.js';

export const listAgentsTool: ToolDefinition<TurnRegistryService> = {
  name: 'list_agents',
  concurrencySafe: true,
  description:
    'List the subagents of this session with their live status (running / complete / interrupt / error) ' +
    'and the purpose each was spawned for. Terminal records from earlier turns are recycled; use ' +
    'resume_agent to continue a finished one by id.',
  parameters: z.object({}),
  execute: (_args, ctx) =>
    Effect.gen(function* () {
      const turn = yield* TurnRegistryService;
      if (!ctx?.sessionId) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'list_agents requires the parent session id')
        );
      }

      const children = yield* turn.listChildren(ctx.sessionId);
      if (children.length === 0) return 'no subagents for this session';

      return children
        .map(
          (c) =>
            `- ${c.agentName ?? '(unnamed)'} (${c.sessionId}) — ${c.state}, turn ${c.turnId}: ${c.description ?? '(no description)'}`
        )
        .join('\n');
    }),
};
