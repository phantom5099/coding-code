import { Effect, Fiber } from 'effect';
import type { Context } from 'hono';
import { AppLayer } from '../layer.js';

export function handler(
  program: ReturnType<typeof Effect.gen>,
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    const result = await Effect.runPromise(
      (program as any).pipe(Effect.provide(AppLayer)),
    );
    return c.json(result);
  };
}

export function sseHandler(
  program: ReturnType<typeof Effect.gen>,
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    const stream = new ReadableStream({
      start(controller) {
        const fiber = Effect.runFork(
          (program as any).pipe(Effect.provide(AppLayer)),
        );

        (async () => {
          try {
            await Fiber.await(fiber);
            controller.enqueue(new TextEncoder().encode('data: {"type":"complete"}\n\n'));
          } catch (e) {
            controller.enqueue(new TextEncoder().encode(`data: {"type":"error","message":"${String(e)}"}\n\n`));
          }
          controller.close();
        })();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  };
}
