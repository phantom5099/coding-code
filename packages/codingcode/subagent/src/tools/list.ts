import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { defineTool } from '@codingcode/tool';
import { TurnRegistryService } from '@codingcode/turn';

const emptyParams = z.object({});

export const listAgentsTool = defineTool<TurnRegistryService, typeof emptyParams>({
  name: 'list_agents',
  concurrencySafe: true,
  description:
    'List the subagents of this session with their live status (running / complete / interrupt / error) ' +
    'and the purpose each was spawned for. Terminal records from earlier turns are recycled; use ' +
    'resume_agent to continue a finished one by id.',
  parameters: emptyParams,
  execute: (_args, ctx) =>
    Effect.gen(function* () {
      const turn = yield* TurnRegistryService;
      const selfSessionId = ctx?.session?.sessionId;
      if (!selfSessionId) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'list_agents requires the parent session id')
        );
      }

      const children = yield* turn.listChildren(selfSessionId);
      if (children.length === 0) return 'no subagents for this session';

      return children
        .map(
          (c) =>
            `- ${c.agentName ?? '(unnamed)'} (${c.sessionId}) — ${c.state}, turn ${c.turnId}: ${c.description ?? '(no description)'}`
        )
        .join('\n');
    }),
});
