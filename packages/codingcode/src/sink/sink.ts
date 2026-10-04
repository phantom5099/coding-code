import { Effect, Layer, Queue } from 'effect';
import type { FrameBody } from '../contracts/frame.js';
import { EventSinkService } from './port.js';

export const EventSinkLayer = Layer.effect(
  EventSinkService,
  Effect.sync(() => {
    const queues = new Map<string, Queue.Queue<FrameBody>>();

    return {
      attach: (sessionId: string) =>
        Effect.sync(() => {
          const q = Effect.runSync(Queue.unbounded<FrameBody>());
          queues.set(sessionId, q);
          return q;
        }),
      detach: (sessionId: string) => Effect.sync(() => void queues.delete(sessionId)),
      emit: (sessionId: string, body: FrameBody) =>
        Effect.sync(() => {
          const q = queues.get(sessionId);
          if (q) Effect.runSync(Queue.offer(q, body));
        }),
      has: (sessionId: string) => Effect.sync(() => queues.has(sessionId)),
    };
  })
);
