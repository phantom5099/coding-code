import { Chunk, Effect, Layer, Queue } from 'effect';
import { MailboxService } from './port.js';
import type { MailboxItem, OfferMailboxCommand } from './types.js';

/**
 * 会话的入站通知队列：条目在 offer 之前已写进收件人转录，队列只负责本回合叫醒收件人。
 * 全局单例，内部按收件人 sessionId 分区。
 */
export const MailboxLayer = Layer.scoped(
  MailboxService,
  Effect.gen(function* () {
    const queues = new Map<string, Queue.Queue<MailboxItem>>();

    const queueFor = (sessionId: string) =>
      Effect.gen(function* () {
        let q = queues.get(sessionId);
        if (!q) {
          q = yield* Queue.unbounded<MailboxItem>();
          queues.set(sessionId, q);
        }
        return q;
      });

    yield* Effect.addFinalizer(() =>
      Effect.forEach([...queues.values()], Queue.shutdown, { discard: true }).pipe(
        Effect.tap(() => Effect.sync(() => queues.clear()))
      )
    );

    return {
      offer: (cmd: OfferMailboxCommand) =>
        Effect.flatMap(queueFor(cmd.recipientSessionId), (q) => Queue.offer(q, cmd.item)),
      drain: (sessionId) => {
        const q = queues.get(sessionId);
        return q
          ? Queue.takeAll(q).pipe(Effect.map(Chunk.toReadonlyArray))
          : Effect.succeed<ReadonlyArray<MailboxItem>>([]);
      },
      dispose: (sessionId) =>
        Effect.gen(function* () {
          const q = queues.get(sessionId);
          if (!q) return;
          queues.delete(sessionId);
          yield* Queue.shutdown(q);
        }),
    };
  })
);
