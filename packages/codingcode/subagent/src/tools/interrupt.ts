import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { defineTool } from '@codingcode/tool';
import { TurnRegistryService } from '@codingcode/turn';

const interruptParams = z.object({
  sessionId: z.string().min(1).describe('session id of the subagent to interrupt'),
});

export const interruptAgentTool = defineTool<TurnRegistryService, typeof interruptParams>({
  name: 'interrupt_agent',
  description:
    'Interrupt the running turn of a subagent you spawned. The subagent session is kept: its ' +
    'transcript survives, and you can continue it later with resume_agent.',
  parameters: interruptParams,
  execute: ({ sessionId }, ctx) =>
    Effect.gen(function* () {
      const turn = yield* TurnRegistryService;
      const selfSessionId = ctx?.session?.sessionId;
      if (!selfSessionId) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'interrupt_agent requires the parent session id')
        );
      }

      const children = yield* turn.listChildren(selfSessionId);
      if (!children.some((c) => c.sessionId === sessionId)) {
        return `${sessionId} is not running`;
      }

      const outcome = yield* turn.interrupt(sessionId);
      return outcome === 'stopped' ? `interrupted ${sessionId}` : `${sessionId} is not running`;
    }),
});
