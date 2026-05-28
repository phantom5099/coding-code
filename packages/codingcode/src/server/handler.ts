import { Effect } from 'effect';
import type { Context } from 'hono';
import { AppLayer } from '../layer.js';
import { registerEmitter, unregisterEmitter } from '../approval/async-confirm.js';
import type { SseEvent } from './adapter.js';

type EffectProgram = Effect.Effect<any, any, any>;

export function handler(
  program: EffectProgram,
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(AppLayer) as any),
    );
    return c.json(result);
  };
}

export function sseHandler(
  createGenerator: () => AsyncGenerator<SseEvent, void, unknown>,
  opts?: { initialEvents?: SseEvent[]; sessionId?: string },
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    const sessionId = opts?.sessionId ?? c.req.param('id') ?? 'default';
    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (data: SseEvent) => {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        };

        registerEmitter(sessionId, (id, tool, args) => {
          enqueue({ type: 'approval_request', id, tool, args });
        });

        try {
          if (opts?.initialEvents) {
            for (const ev of opts.initialEvents) enqueue(ev);
          }

          const generator = createGenerator();

          for await (const event of generator) {
            enqueue(event);
          }

          enqueue({ type: 'complete' });
        } catch (e) {
          enqueue({
            type: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        } finally {
          unregisterEmitter(sessionId);
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  };
}
