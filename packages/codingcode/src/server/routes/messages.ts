import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { AgentService } from '../../agent/port.js';
import { resolveWorkspaceCwd } from '../cwd.js';
import { isAgentProfileName } from '../../agent/profile.js';
import { isPermissionMode } from '../../approval/types.js';
import { loadConfig } from '../../infra/config.js';
import { errorBody, errorResponse } from '../util.js';
import { createSseHandler } from '../handler.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerMessagesRoutes(router: Hono, rt: ManagedRt): void {
  const sseHandler = createSseHandler(rt);

  router.post('/api/sessions/:id/messages', async (c) => {
    let sessionId = c.req.param('id');
    const { input, cwd, model, skills } = await c.req.json<{
      input: string;
      cwd: string;
      model?: string;
      skills?: Array<{ name: string; path: string }>;
    }>();
    // 模型是回合的必要输入，缺失即拒绝，不允许在 agent 层兜底成空串
    if (!model?.trim()) {
      return c.json(errorBody('CONFIG_MISSING', 'model is required'), 400);
    }
    // 工作区目录必须存在，否则拒绝（不允许带着不存在的路径开回合）
    const normalizedCwd = resolveWorkspaceCwd(cwd);

    const isNew = sessionId === '_' || !sessionId;
    const runOpts: any = {
      cwd: normalizedCwd,
      signal: c.req.raw.signal,
      model,
      skills,
    };
    if (isNew) {
      // 新会话的交互/权限模式取自 config.yaml；会话一旦建立就以会话头为准
      const cfg = loadConfig();
      runOpts.activeProfile = isAgentProfileName(cfg.activeProfile) ? cfg.activeProfile : 'build';
      runOpts.permissionMode = isPermissionMode(cfg.permissionMode)
        ? cfg.permissionMode
        : 'askBeforeExec';
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
        yield* stream;
      },
      { sessionId }
    )(c);
  });
}
