import { Hono } from 'hono';
import { Effect } from 'effect';
import { sseHandler } from '../handler.js';
import { sendMessage } from '../../agent/agent.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';
import { AppLayer } from '../../layer.js';
import { toSseEvents } from '../adapter.js';
import { ApprovalService } from '../../approval/index.js';
import { resolveSessionDir } from '../../session/store.js';
import { getPermissionMode } from '../../session/store.js';
import { join } from 'path';
import type { PermissionMode } from '../../approval/types.js';

export const messagesRouter = new Hono();

function runWithLayer<T>(eff: Effect.Effect<T, unknown, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

messagesRouter.post('/sessions/:id/messages', async (c) => {
  let sessionId = c.req.param('id');
  const { input, cwd } = await c.req.json<{ input: string; cwd: string }>();
  const normalizedCwd = resolveWorkspaceCwd(cwd);
  const llm = c.get('llm');

  // Read session permissionMode if session exists
  let approvalOverride: any = undefined;
  if (sessionId !== '_') {
    const dir = resolveSessionDir(sessionId);
    if (dir) {
      const idxPath = join(dir, `${sessionId}.index.json`);
      const mode = getPermissionMode(idxPath) as PermissionMode;
      // Fork approval service with session-scoped permission mode
      const forked: any = await Effect.runPromise(
        Effect.gen(function* () {
          const approval = yield* ApprovalService;
          return yield* approval.fork({});
        }).pipe(Effect.provide(AppLayer) as any),
      );
      await Effect.runPromise(forked.setPermissionMode(mode));
      approvalOverride = forked;
    }
  }

  const program = sendMessage(
    sessionId === '_' || !sessionId ? undefined : sessionId,
    input,
    normalizedCwd,
    llm,
    { signal: c.req.raw.signal },
  );

  const { stream, sessionId: actualSid } = await runWithLayer(program);
  sessionId = actualSid;

  // If newly created session, fork approval with default mode
  if (!approvalOverride && sessionId !== '_') {
    const forked: any = await Effect.runPromise(
      Effect.gen(function* () {
        const approval = yield* ApprovalService;
        return yield* approval.fork({});
      }).pipe(Effect.provide(AppLayer) as any),
    );
    approvalOverride = forked;
  }

  return sseHandler(
    async function* () {
      yield* toSseEvents(stream);
    },
    {
      initialEvents: [{ type: 'session_id', sessionId }],
      sessionId,
    },
  )(c);
});
