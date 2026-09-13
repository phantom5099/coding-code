import type { Context } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { ApprovalWaitService } from '../approval/wait-port.js';
import { AgentError } from '../core/error.js';
import type { FrameBody } from '../core/frame.js';
import { createFrameAssembler, encodeFrame } from '../core/frame-io.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function createSseHandler(rt: ManagedRt) {
  return function sseHandler(
    createGenerator: () => AsyncGenerator<FrameBody, void, unknown>,
    opts?: { sessionId?: string; onDone?: () => void }
  ): (c: Context) => Promise<Response> {
    return async (c) => {
      const sessionId = opts?.sessionId ?? c.req.param('id') ?? 'default';
      const stream = new ReadableStream({
        async start(controller) {
          const assembler = createFrameAssembler({ sessionId });
          const emit = (body: FrameBody) => {
            const frame = assembler.stamp(body);
            controller.enqueue(new TextEncoder().encode(`data: ${encodeFrame(frame)}\n\n`));
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
                emit({ family: 'event', event: { type: 'approval_request', id, tool, args } });
              }
            )
          );

          try {
            const generator = createGenerator();

            for await (const body of generator) {
              emit(body);
            }
          } catch (e) {
            emit({
              family: 'fatal',
              fatal: {
                message: e instanceof Error ? e.message : String(e),
                code: e instanceof AgentError ? e.code : 'INTERNAL_ERROR',
              },
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
