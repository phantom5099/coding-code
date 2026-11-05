import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../util/error.js';
import { transcriptPathOf } from '../../../session/paths.js';
import { SUBAGENT_MESSAGE_PREFIX } from '../../../session/types.js';
import type { SubagentMessageEvent } from '../../../session/types.js';
import { MailboxService } from '../../../session/mailbox.js';
import { SessionService } from '../../../session/port.js';
import type { ToolDefinition } from '../../types.js';

export const sendMessageTool: ToolDefinition<MailboxService | SessionService> = {
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
      const session = yield* SessionService;
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
      const ancestorAt = chain.indexOf(sessionId);
      // 收件人转录：祖先自己的链是本链中它之后的部分；直接子代的父就是本会话
      const recipientPath =
        ancestorAt >= 0
          ? transcriptPathOf(
              projectPath,
              sessionId,
              chain[ancestorAt + 1],
              chain.slice(ancestorAt + 1)
            )
          : transcriptPathOf(projectPath, sessionId, selfSessionId, [selfSessionId, ...chain]);

      const known = existsSync(recipientPath);
      if (ancestorAt < 0 && !known) {
        return yield* Effect.fail(
          new AgentError('INVALID_INPUT', `Unknown recipient: ${sessionId}`)
        );
      }
      // 发送方归属行：链条为空 = 顶层主智能体
      const from =
        chain.length === 0
          ? `以下是来自于当前主智能体（id：${selfSessionId}）的信息`
          : `以下是来自于（${ctx?.agentName ?? 'unknown'}）智能体（id：${selfSessionId}）的信息`;

      const event: SubagentMessageEvent = {
        type: 'subagent_message',
        uuid: randomUUID(),
        sessionId: selfSessionId,
        agentName: ctx?.agentName ?? '',
        content: `${SUBAGENT_MESSAGE_PREFIX}\n${from}\n${message}`,
      };

      // 与子代理结果同一条契约：先落盘再入队，收件人不在线也不会丢。
      // 只追加到已存在的转录 —— 祖先链可能指向已删除的会话，不新建幽灵转录
      if (known) yield* session.appendEvent(recipientPath, event).pipe(Effect.ignore);
      yield* mailbox.offer(sessionId, event);

      return `delivered to ${sessionId}`;
    }),
};
