import { Effect } from 'effect';
import type { Context } from 'hono';
import { AppLayer } from '../layer.js';
import { approvalEmitter } from '../approval/async-confirm.js';

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
  program: EffectProgram,
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

        // 设置全局发射器：由 userConfirmAsync 调用，直接推送到 SSE 流
        approvalEmitter.current = (
          id: string,
          tool: string,
          args: Record<string, unknown>,
        ) => {
          enqueue({ type: 'approval_request', id, tool, args });
        };

        try {
          if (opts?.initialEvents) {
            for (const ev of opts.initialEvents) enqueue(ev);
          }

          const generator: AsyncIterable<string> = await Effect.runPromise(
            program.pipe(Effect.provide(AppLayer) as any),
          );

          for await (const chunk of generator) {
            enqueue({ type: 'text', text: chunk });
          }

          enqueue({ type: 'complete' });
        } catch (e) {
          enqueue({
            type: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        } finally {
          approvalEmitter.current = null;
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
