import { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { sendMessage } from '../../agent/agent.js';
import { WorkspaceService } from '../../core/workspace.js';
import { toSseEvents } from '../adapter.js';
import { ApprovalService } from '../../approval/index.js';
import { sessionJsonlPathFromCwd, getPermissionMode } from '../../session/file-ops.js';
import { existsSync } from 'fs';
import type { PermissionMode } from '../../approval/types.js';
import { LLMFactoryService } from '../../llm/factory.js';
import { errorResponse } from '../util.js';
import { createSseHandler } from '../handler.js';
import { activeApprovalForks } from './sessions.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function createMessagesRouter(rt: ManagedRt): Hono {
  const router = new Hono();
  const sseHandler = createSseHandler(rt);

  router.post('/sessions/:id/messages', async (c) => {
    let sessionId = c.req.param('id');
    const { input, cwd } = await c.req.json<{ input: string; cwd: string }>();
    const normalizedCwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(cwd);
      })
    );

    const llmEither = await rt.runPromise(
      Effect.gen(function* () {
        const factory = yield* LLMFactoryService;
        return yield* Effect.either(factory.getLLMClient());
      })
    );
    if (llmEither._tag === 'Left') {
      const { status, body } = errorResponse(llmEither.left);
      return c.json(body, status as any);
    }
    const llm = llmEither.right;

    // Read session permissionMode if session exists
    let approvalOverride: any = undefined;
    if (sessionId !== '_') {
      const idxPath = sessionJsonlPathFromCwd(normalizedCwd, sessionId).replace(
        '.jsonl',
        '.index.json'
      );
      if (existsSync(idxPath)) {
        const mode = getPermissionMode(idxPath) as PermissionMode;
        const forked: any = await rt.runPromise(
          Effect.gen(function* () {
            const approval = yield* ApprovalService;
            return yield* approval.fork({});
          })
        );
        await rt.runPromise(forked.setPermissionMode(mode));
        approvalOverride = forked;
        activeApprovalForks.set(sessionId, {
          setPermissionMode: (m) => rt.runPromise(forked.setPermissionMode(m)),
        });
      }
    }

    const program = sendMessage(
      sessionId === '_' || !sessionId ? undefined : sessionId,
      input,
      normalizedCwd,
      llm,
      {
        signal: c.req.raw.signal,
        approvalOverride,
        mode: 'build',
        permissionMode: 'default',
        model: llm.modelInfo.model,
      }
    );

    const result = await rt.runPromise(
      program.pipe(
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

    // If newly created session, fork approval with default mode
    if (!approvalOverride && sessionId !== '_') {
      const forked: any = await rt.runPromise(
        Effect.gen(function* () {
          const approval = yield* ApprovalService;
          return yield* approval.fork({});
        })
      );
      approvalOverride = forked;
      activeApprovalForks.set(sessionId, {
        setPermissionMode: (m) => rt.runPromise(forked.setPermissionMode(m)),
      });
    }

    return sseHandler(
      async function* () {
        yield* toSseEvents(stream);
      },
      {
        initialEvents: [{ type: 'session_id', sessionId }],
        sessionId,
        onDone: () => {
          activeApprovalForks.delete(sessionId);
        },
      }
    )(c);
  });

  return router;
}
