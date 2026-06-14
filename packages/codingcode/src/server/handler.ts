import type { Context } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { ApprovalWaitService } from '../approval/async-confirm.js';
import type { SseEvent } from './types.js';
import { AgentError } from '../core/error.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function createSseHandler(rt: ManagedRt) {
  return function sseHandler(
    createGenerator: () => AsyncGenerator<SseEvent, void, unknown>,
    opts?: { initialEvents?: SseEvent[]; sessionId?: string; onDone?: () => void }
  ): (c: Context) => Promise<Response> {
    return async (c: Context) => {
      const sessionId = opts?.sessionId ?? c.req.param('id') ?? 'default';
      const stream = new ReadableStream({
        async start(controller) {
          const enqueue = (data: SseEvent) => {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
          };

          const waitService = await rt.runPromise(
            Effect.gen(function* () {
              return yield* ApprovalWaitService;
            })
          );
          Effect.runSync(
            waitService.registerEmitter(
              sessionId,
              (id: string, tool: string, args: Record<string, unknown>) => {
                enqueue({ type: 'approval_request', id, tool, args });
              }
            )
          );

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
              ...(e instanceof AgentError ? { code: e.code } : {}),
            });
          } finally {
            Effect.runSync(waitService.unregisterEmitter(sessionId));
            opts?.onDone?.();
          }
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    };
  };
}
