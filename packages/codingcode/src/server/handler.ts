import { Effect } from 'effect';
import type { Context } from 'hono';
import { AppLayer } from '../layer.js';

type EffectProgram = Effect.Effect<any, any, any>;

export function handler(
  program: EffectProgram,
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>,
    );
    return c.json(result);
  };
}

export function sseHandler(
  program: EffectProgram,
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const generator: AsyncIterable<string> = await Effect.runPromise(
            program.pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>,
          );

          for await (const chunk of generator) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`,
              ),
            );
          }

          controller.enqueue(
            new TextEncoder().encode('data: {"type":"complete"}\n\n'),
          );
        } catch (e) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: {"type":"error","message":"${String(e)}"}\n\n`,
            ),
          );
        }
        controller.close();
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
