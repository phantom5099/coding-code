import type { SubagentMessageEvent, SubagentResultEvent } from '@codingcode/session';

/** 入站暂存条目：子代理终态结果，或其它智能体主动投递的来信；都是已落盘的事件 */
export type MailboxItem = SubagentResultEvent | SubagentMessageEvent;

/** 投递入站消息的命令对象（显式区分收件人与 item 内的发件人 sessionId） */
export interface OfferMailboxCommand {
  readonly recipientSessionId: string;
  readonly item: MailboxItem;
}
