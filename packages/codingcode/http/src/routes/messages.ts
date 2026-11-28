import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { AgentService, type RunTurnOptions } from '@codingcode/agent';
import { NEW_SESSION_SENTINEL, resolveWorkspaceCwd } from '../cwd.js';
import { loadConfig } from '@codingcode/infra';
import { AgentError } from '@codingcode/util';
import type { IncomingMedia, IncomingPart } from '@codingcode/model';
import type { SkillRef } from '@codingcode/skill';
import type { WireInputPart } from '../dto.js';
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

type MessageBody = {
  input: WireInputPart[];
  cwd: string;
  model?: string;
  inputId?: string;
  skills?: SkillRef[];
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
  const cwd = resolveWorkspaceCwd(body.cwd);

  const input = yield* Effect.try({
    try: () => toIncomingParts(body.input),
    catch: (e) => (e instanceof AgentError ? e : AgentError.invalidInput(String(e))),
  });

  const sessionId = id ?? '';
  const isNew = sessionId === NEW_SESSION_SENTINEL || !sessionId;
  const runOpts: RunTurnOptions = {
    sessionId: isNew ? undefined : sessionId,
    cwd,
    signal: web.signal,
    model: body.model,
    inputId: body.inputId,
    skills: body.skills,
    ...(isNew ? { permissionMode: loadConfig().permissionMode } : {}),
  };

  const agent = yield* AgentService;
  const result = yield* agent.runTurn(input, runOpts);

  if (result.kind === 'queued') {
    return json({ queued: true, sessionId: result.sessionId, turnId: result.turnId }, 202);
  }
  return yield* sseResponse(frameStream(result.stream), { sessionId: result.sessionId });
});

export const addMessagesRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.post('/api/sessions/:id/messages', sendMessage));
