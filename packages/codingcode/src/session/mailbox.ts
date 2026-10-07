import { Chunk, Context, Effect, Layer, Queue } from 'effect';
import type { SubagentResultEvent } from './types.js';

/** 入站暂存条目。当前唯一生产者是子代理终态 —— 不预留其它变体 */
export type MailboxItem = SubagentResultEvent;

export interface MailboxShape {
  /** 投递；该会话还没有队列时自动建 */
  offer(sessionId: string, item: MailboxItem): Effect.Effect<void>;
  /** 取走当前全部待处理条目（非阻塞，空则返回空数组） */
  drain(sessionId: string): Effect.Effect<ReadonlyArray<MailboxItem>>;
  /** 会话删除时清空 */
  dispose(sessionId: string): Effect.Effect<void>;
}

export class MailboxService extends Context.Tag('Mailbox')<MailboxService, MailboxShape>() {}

/**
 * 会话的易失入站队列，与 transcript（持久出站）对称：同一把键 sessionId。
 * 全局单例，内部按收件人分区 —— 嵌套委派下 B 的终态进 mailbox[A]。
 */
export const MailboxLayer = Layer.scoped(
  MailboxService,
  Effect.gen(function* () {
    const queues = new Map<string, Queue.Queue<MailboxItem>>();
    const queueFor = (sessionId: string) => {
      let q = queues.get(sessionId);
      if (!q) {
        q = Effect.runSync(Queue.unbounded<MailboxItem>());
        queues.set(sessionId, q);
      }
      return q;
    };

    yield* Effect.addFinalizer(() => Effect.sync(() => queues.clear()));

    return {
      offer: (sessionId, item) => Queue.offer(queueFor(sessionId), item),
      drain: (sessionId) => {
        const q = queues.get(sessionId);
        return q
          ? Queue.takeAll(q).pipe(Effect.map(Chunk.toReadonlyArray))
          : Effect.succeed<ReadonlyArray<MailboxItem>>([]);
      },
      dispose: (sessionId) =>
        Effect.sync(() => {
          queues.delete(sessionId);
        }),
    };
  })
);
