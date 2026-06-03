import { Hono } from 'hono';
import { Effect } from 'effect';
import { sseHandler } from '../handler.js';
import { sendMessage } from '../../agent/agent.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';
import { AppLayer } from '../../layer.js';
import { toSseEvents } from '../adapter.js';
import { ApprovalService, registerSessionApproval, unregisterSessionApproval } from '../../approval/index.js';
import { resolveSessionDir, getPermissionMode } from '../../session/io.js';
import { join } from 'path';
import type { PermissionMode } from '../../approval/types.js';
import { getLLMClient } from '../../llm/factory.js';
import { runWithLayer, errorResponse } from '../util.js';

export const messagesRouter = new Hono();

messagesRouter.post('/sessions/:id/messages', async (c) => {
  let sessionId = c.req.param('id');
  const { input, cwd } = await c.req.json<{ input: string; cwd: string }>();
  const normalizedCwd = resolveWorkspaceCwd(cwd);

  const llmResult = await getLLMClient();
  if (!llmResult.ok) {
    const { status, body } = errorResponse(llmResult.error);
    return c.json(body, status as any);
  }
  const llm = llmResult.value;

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
        }).pipe(Effect.provide(AppLayer) as any)
      );
      await Effect.runPromise(forked.setPermissionMode(mode));
      approvalOverride = forked;
      registerSessionApproval(sessionId, forked);
    }
  }

  const program = sendMessage(
    sessionId === '_' || !sessionId ? undefined : sessionId,
    input,
    normalizedCwd,
    llm,
    { signal: c.req.raw.signal }
  );

  const result = await runWithLayer(program);
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  const { stream, sessionId: actualSid } = result.value;
  sessionId = actualSid;

  // If newly created session, fork approval with default mode
  if (!approvalOverride && sessionId !== '_') {
    const forked: any = await Effect.runPromise(
      Effect.gen(function* () {
        const approval = yield* ApprovalService;
        return yield* approval.fork({});
      }).pipe(Effect.provide(AppLayer) as any)
    );
    approvalOverride = forked;
    registerSessionApproval(sessionId, forked);
  }

  return sseHandler(
    async function* () {
      yield* toSseEvents(stream);
    },
    {
      initialEvents: [{ type: 'session_id', sessionId }],
      sessionId,
      onDone: () => {
        unregisterSessionApproval(sessionId);
      },
    }
  )(c);
});
