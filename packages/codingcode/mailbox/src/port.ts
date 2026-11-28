import { Context } from 'effect';
import type { Effect } from 'effect';
import type { MailboxItem, OfferMailboxCommand } from './types.js';

export interface MailboxShape {
  /** 投递；目标收件人尚无队列时自动建 */
  offer(cmd: OfferMailboxCommand): Effect.Effect<void>;
  /** 取走当前全部待处理条目（非阻塞，空则返回空数组） */
  drain(sessionId: string): Effect.Effect<ReadonlyArray<MailboxItem>>;
  /** 会话删除时清空并关闭队列 */
  dispose(sessionId: string): Effect.Effect<void>;
}

export class MailboxService extends Context.Tag('Mailbox')<MailboxService, MailboxShape>() {}
