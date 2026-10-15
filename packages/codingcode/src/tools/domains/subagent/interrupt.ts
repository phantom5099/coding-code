import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../util/error.js';
import type { ToolDefinition } from '../../types.js';
import { TurnRegistryService } from '../../../turn/port.js';

export const interruptAgentTool: ToolDefinition<TurnRegistryService> = {
  name: 'interrupt_agent',
  description:
    'Interrupt the running turn of a subagent you spawned. The subagent session is kept: its ' +
    'transcript survives, and you can continue it later with resume_agent.',
  parameters: z.object({
    sessionId: z.string().min(1).describe('session id of the subagent to interrupt'),
  }),
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const turn = yield* TurnRegistryService;
      const { sessionId } = args as { sessionId: string };
      if (!ctx?.sessionId) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'interrupt_agent requires the parent session id')
        );
      }

      // 只查内存注册表：不在册（已终态或 id 无效）一律回 not running，不读磁盘——
      // 区分「已终态」与「不是我的」对模型没有行动价值，下一步反正都是 wait/list
      const children = yield* turn.listChildren(ctx.sessionId);
      if (!children.some((c) => c.sessionId === sessionId)) {
        return `${sessionId} is not running`;
      }

      const outcome = yield* turn.interrupt(sessionId);
      return outcome === 'stopped' ? `interrupted ${sessionId}` : `${sessionId} is not running`;
    }),
};
