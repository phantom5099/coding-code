import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { AgentService } from '../../agent/port.js';
import { resolveWorkspaceCwd } from '../cwd.js';
import { isAgentProfileName } from '../../agent/profile.js';
import { isPermissionMode } from '../../approval/types.js';
import { loadConfig } from '../../infra/config.js';
import { AgentError } from '../../core/error.js';
import {
  frameStream,
  pathParams,
  readJsonFrom,
  sseResponse,
  webRequest,
  type Handler,
  type Router,
} from '../handler.js';

/** POST body 的线上形状：模型是回合的必要输入，缺失即拒绝，不在 agent 层兜底成空串。 */
type MessageBody = {
  input: string;
  cwd: string;
  model?: string;
  skills?: Array<{ name: string; path: string }>;
};

const sendMessage: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const web = yield* webRequest;
  const body = yield* readJsonFrom<MessageBody>(web);

  if (!body.model?.trim()) {
    return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'model is required'));
  }
  // 工作区目录必须存在，否则拒绝（不允许带着不存在的路径开回合）
  const cwd = resolveWorkspaceCwd(body.cwd);

  const sessionId = id ?? '';
  const isNew = sessionId === '_' || !sessionId;
  const runOpts: Record<string, unknown> = {
    cwd,
    signal: web.signal,
    model: body.model,
    skills: body.skills,
  };
  if (isNew) {
    // 新会话的交互/权限模式取自 config.yaml；会话一旦建立就以会话头为准
    const cfg = loadConfig();
    runOpts.activeProfile = isAgentProfileName(cfg.activeProfile) ? cfg.activeProfile : 'build';
    runOpts.permissionMode = isPermissionMode(cfg.permissionMode)
      ? cfg.permissionMode
      : 'askBeforeExec';
  }

  const agent = yield* AgentService;
  const { stream, sessionId: actualSid } = yield* agent.runTurn(body.input, {
    sessionId: isNew ? undefined : sessionId,
    ...runOpts,
  } as never);

  return yield* sseResponse(frameStream(stream), { sessionId: actualSid });
});

export const addMessagesRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.post('/api/sessions/:id/messages', sendMessage));
