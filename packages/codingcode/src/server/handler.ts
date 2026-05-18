import { Effect } from 'effect';
import type { Context } from 'hono';
import { AppLayer } from '../layer.js';

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

export function handler(
  program: Effect.Effect<any, any, any>,
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    const result = await runWithLayer(program);
    return c.json(result);
  };
}

export function sseHandler(
  program: Effect.Effect<any, any, any>,
  opts?: { initialEvents?: Array<Record<string, unknown>> },
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (data: Record<string, unknown>) => {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        };

        try {
          if (opts?.initialEvents) {
            for (const ev of opts.initialEvents) enqueue(ev);
          }

          const generator: AsyncIterable<string> = await runWithLayer(program);

          for await (const chunk of generator) {
            enqueue({ type: 'text', text: chunk });
          }

          enqueue({ type: 'complete' });
        } catch (e) {
          enqueue({
            type: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
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
