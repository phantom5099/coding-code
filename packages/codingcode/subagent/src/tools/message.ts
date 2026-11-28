import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { MailboxService } from '@codingcode/mailbox';
import {
  SUBAGENT_MESSAGE_PREFIX,
  SessionService,
  resolveRelatedLocator,
  transcriptPathOf,
  type SubagentMessageEvent,
} from '@codingcode/session';
import { defineTool } from '@codingcode/tool';

const messageParams = z.object({
  sessionId: z.string().min(1).describe('recipient session id'),
  message: z.string().min(1).describe('message body'),
});

export const sendMessageTool = defineTool<MailboxService | SessionService, typeof messageParams>({
  name: 'send_message',
  concurrencySafe: true,
  description:
    'Deliver a message into another agent mailbox. Recipients: any of your ancestors (parent, ' +
    'grandparent, up to the main agent) or your direct subagents. Queue-only: the recipient reads ' +
    'it at its next step boundary; an idle recipient is not woken up (resume_agent with a prompt wakes it).',
  parameters: messageParams,
  execute: ({ sessionId, message }, ctx) =>
    Effect.gen(function* () {
      const mailbox = yield* MailboxService;
      const session = yield* SessionService;
      const self = ctx?.session;
      if (!ctx || !self?.cwd || !ctx.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_POLICY_DENIED', 'send_message requires a sandbox policy')
        );
      }
      if (!self.sessionId) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'send_message requires the sender session id')
        );
      }

      const recipient = resolveRelatedLocator(self, sessionId);
      if (!existsSync(transcriptPathOf(recipient))) {
        return yield* Effect.fail(
          new AgentError('INVALID_INPUT', `Unknown recipient: ${sessionId}`)
        );
      }

      const chain = self.parentChain ?? [];
      const from =
        chain.length === 0
          ? `以下是来自于当前主智能体（id：${self.sessionId}）的信息`
          : `以下是来自于（${ctx.agentName ?? 'unknown'}）智能体（id：${self.sessionId}）的信息`;

      const event: SubagentMessageEvent = {
        type: 'subagent_message',
        uuid: randomUUID(),
        sessionId: self.sessionId,
        agentName: ctx.agentName ?? '',
        content: `${SUBAGENT_MESSAGE_PREFIX}\n${from}\n${message}`,
      };

      yield* session.appendEvent(recipient, event).pipe(Effect.ignore);
      yield* mailbox.offer({ recipientSessionId: sessionId, item: event });

      return `delivered to ${sessionId}`;
    }),
});
