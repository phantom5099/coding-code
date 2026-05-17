import { Effect, PubSub } from 'effect';
import type { AgentError } from '../core/error.js';

export type BusEvent =
  | { type: 'stateChange'; state: string }
  | { type: 'step'; step: number; max: number }
  | { type: 'toolCall'; name: string; arguments: Record<string, unknown> }
  | { type: 'toolResult'; name: string; ok: boolean; durationMs: number }
  | { type: 'error'; error: AgentError }
  | { type: 'compaction'; didCompress: boolean; summary?: string }
  | { type: 'sessionCreated'; sessionId: string }
  | { type: 'sessionResumed'; sessionId: string };

export class Bus extends Effect.Service<Bus>()('Bus', {
  effect: Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<BusEvent>();
    return {
      publish: (event: BusEvent) =>
        Effect.suspend(() => pubsub.publish(event)) as Effect.Effect<void>,
    };
  }),
  dependencies: [],
}) {}
