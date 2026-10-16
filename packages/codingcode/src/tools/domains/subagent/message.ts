import { existsSync } from 'fs';
import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../util/error.js';
import { transcriptPathOf } from '../../../session/paths.js';
import { SUBAGENT_MESSAGE_PREFIX } from '../../../session/types.js';
import { MailboxService } from '../../../session/mailbox.js';
import type { ToolDefinition } from '../../types.js';

export const sendMessageTool: ToolDefinition<MailboxService> = {
  name: 'send_message',
  concurrencySafe: true,
  description:
    'Deliver a message into another agent mailbox. Recipients: any of your ancestors (parent, ' +
    'grandparent, up to the main agent) or your direct subagents. Queue-only: the recipient reads ' +
    'it at its next step boundary; an idle recipient is not woken up (resume_agent with a prompt wakes it).',
  parameters: z.object({
    sessionId: z.string().min(1).describe('recipient session id'),
    message: z.string().min(1).describe('message body'),
  }),
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const mailbox = yield* MailboxService;
      const { sessionId, message } = args as { sessionId: string; message: string };
      const projectPath = ctx?.projectPath || process.cwd();
      const selfSessionId = ctx?.sessionId;

      if (!selfSessionId) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'send_message requires the sender session id')
        );
      }
      // TODO:后续修改格式，让同一根会话下的所有子智能体都能互相访问
      const chain = ctx?.parentChain ?? [];
      const isAncestor = chain.includes(sessionId);
      const childChain = [selfSessionId, ...chain];
      if (
        !isAncestor &&
        !existsSync(transcriptPathOf(projectPath, sessionId, selfSessionId, childChain))
      ) {
        return yield* Effect.fail(
          new AgentError('INVALID_INPUT', `Unknown recipient: ${sessionId}`)
        );
      }

      // 发送方归属行：链条为空 = 顶层主智能体
      const from =
        chain.length === 0
          ? `以下是来自于当前主智能体（id：${selfSessionId}）的信息`
          : `以下是来自于（${ctx?.agentName ?? 'unknown'}）智能体（id：${selfSessionId}）的信息`;

      yield* mailbox.offer(sessionId, {
        type: 'subagent_message',
        sessionId: selfSessionId,
        agentName: ctx?.agentName ?? '',
        content: `${SUBAGENT_MESSAGE_PREFIX}\n${from}\n${message}`,
      });

      return `delivered to ${sessionId}`;
    }),
};
