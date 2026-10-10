import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { AgentService } from '../../agent/port.js';
import { resolveWorkspaceCwd } from '../cwd.js';
import { isAgentProfileName } from '../../agent/profile.js';
import { isPermissionMode } from '../../approval/types.js';
import { loadConfig } from '../../infra/config.js';
import { AgentError } from '../../util/error.js';
import { ASK_BEFORE_EXEC_PERMISSION_MODE, BUILD_PROFILE_NAME } from '../../util/enums.js';
import type { IncomingMedia, IncomingPart } from '../../llm/types.js';
import {
  frameStream,
  json,
  pathParams,
  readJsonFrom,
  sseResponse,
  webRequest,
  type Handler,
  type Router,
} from '../handler.js';

/** 线上内容部件的形状。 */
type WirePart =
  | { type: 'text'; text: string }
  | { type: 'media'; dataUrl: string; filename?: string };

/** POST body 的线上形状：模型是回合的必要输入，缺失即拒绝，不在 agent 层兜底成空串。 */
type MessageBody = {
  input: WirePart[];
  cwd: string;
  model?: string;
  /** 前端队列项 id：命中活跃回合时原样回显在 user_input 帧上 */
  inputId?: string;
  skills?: Array<{ name: string; path: string }>;
};

const DATA_URL_RE = /^data:([^;,]+);base64,(.*)$/s;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function toIncomingParts(input: unknown): IncomingPart[] {
  if (!Array.isArray(input)) {
    throw AgentError.invalidInput('input must be an array of content parts');
  }
  const parts: IncomingPart[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) {
      throw AgentError.invalidInput('input contains a non-object content part');
    }
    const p = raw as Record<string, unknown>;
    if (p.type === 'text') {
      if (typeof p.text !== 'string') {
        throw AgentError.invalidInput('text part requires a string "text"');
      }
      parts.push({ type: 'text', text: p.text });
      continue;
    }
    if (p.type === 'media') {
      const dataUrl = typeof p.dataUrl === 'string' ? p.dataUrl : '';
      const matched = DATA_URL_RE.exec(dataUrl);
      const payload = matched?.[2] ?? '';
      if (!matched || !BASE64_RE.test(payload) || payload.length % 4 === 1) {
        throw AgentError.invalidInput('media part requires a base64 data URL');
      }
      const media: IncomingMedia = {
        type: 'media',
        bytes: new Uint8Array(Buffer.from(payload, 'base64')),
        ...(matched[1] ? { declaredMimeType: matched[1] } : {}),
      };
      if (typeof p.filename === 'string' && p.filename) media.filename = p.filename;
      parts.push(media);
      continue;
    }
    throw AgentError.invalidInput(`unknown content part type: ${String(p.type)}`);
  }
  return parts;
}

const sendMessage: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const web = yield* webRequest;
  const body = yield* readJsonFrom<MessageBody>(web);

  if (!body.model?.trim()) {
    return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'model is required'));
  }
  // 工作区目录必须存在，否则拒绝（不允许带着不存在的路径开回合）
  const cwd = resolveWorkspaceCwd(body.cwd);

  const input = yield* Effect.try({
    try: () => toIncomingParts(body.input),
    catch: (e) => (e instanceof AgentError ? e : AgentError.invalidInput(String(e))),
  });

  const sessionId = id ?? '';
  const isNew = sessionId === '_' || !sessionId;
  const runOpts: Record<string, unknown> = {
    cwd,
    signal: web.signal,
    model: body.model,
    inputId: body.inputId,
    skills: body.skills,
  };
  if (isNew) {
    const cfg = loadConfig();
    runOpts.activeProfile = isAgentProfileName(cfg.activeProfile)
      ? cfg.activeProfile
      : BUILD_PROFILE_NAME;
    runOpts.permissionMode = isPermissionMode(cfg.permissionMode)
      ? cfg.permissionMode
      : ASK_BEFORE_EXEC_PERMISSION_MODE;
  }

  const agent = yield* AgentService;
  const result = yield* agent.runTurn(input, {
    sessionId: isNew ? undefined : sessionId,
    ...runOpts,
  } as never);

  // 命中活跃回合：输入已进状态表，不开新流，回 202
  if (result.kind === 'queued') {
    return json({ queued: true, sessionId: result.sessionId, turnId: result.turnId }, 202);
  }
  return yield* sseResponse(frameStream(result.stream), { sessionId: result.sessionId });
});

export const addMessagesRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.post('/api/sessions/:id/messages', sendMessage));
