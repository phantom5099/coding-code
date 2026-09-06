import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { AgentService } from '../../agent/port.js';
import { WorkspaceService } from '../../core/workspace.js';
import { toSseEvents } from '../adapter.js';
import { errorResponse } from '../util.js';
import { createSseHandler } from '../handler.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerMessagesRoutes(router: Hono, rt: ManagedRt): void {
  const sseHandler = createSseHandler(rt);

  router.post('/api/sessions/:id/messages', async (c) => {
    let sessionId = c.req.param('id');
    const { input, cwd } = await c.req.json<{ input: string; cwd: string }>();
    const normalizedCwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(cwd);
      })
    );

    const isNew = sessionId === '_' || !sessionId;
    const runOpts: any = {
      cwd: normalizedCwd,
      signal: c.req.raw.signal,
    };
    if (isNew) {
      runOpts.activeProfile = 'build';
      runOpts.permissionMode = 'default';
    }

    const result = await rt.runPromise(
      Effect.gen(function* () {
        const agent = yield* AgentService;
        return yield* agent.runTurn(input, {
          sessionId: isNew ? undefined : sessionId,
          ...runOpts,
        });
      }).pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
          onFailure: (e) => ({ ok: false as const, error: e }),
        })
      )
    );

    if (!result.ok) {
      const { status, body } = errorResponse(result.error);
      return c.json(body, status as any);
    }
    const { stream, sessionId: actualSid } = result.value as any;
    sessionId = actualSid;

    return sseHandler(
      async function* () {
        yield* toSseEvents(stream);
      },
      {
        initialEvents: [{ type: 'session_id', sessionId }],
        sessionId,
      }
    )(c);
  });
}
