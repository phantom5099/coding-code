import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import type { SessionStoreState } from '../../session/types.js';
import {
  ASK_BEFORE_EXEC_PERMISSION_MODE,
  type PermissionMode,
} from '../../util/enums.js';

import { SessionService } from '../../session/port.js';
import { computePaths } from '../../session/paths.js';
import { ContextService } from '../../context/port.js';
import { MailboxService } from '../../session/mailbox.js';
import { TurnRegistryService } from '../../turn/port.js';
import { TodoService } from '../../todo/port.js';
import { estimatePromptTokensFrom } from '../../context/context.js';
import { CheckpointService } from '../../checkpoint/port.js';
import { activeModelId, setGlobalActive } from '../../infra/models.js';
import { resolveCwd, resolveWorkspaceCwd } from '../cwd.js';
import { isPermissionMode } from '../../approval/types.js';
import { AgentError } from '../../util/error.js';
import { json, pathParams, query, readJson, type Handler, type Router } from '../handler.js';
import type { AppError } from '../http-error.js';

// ---- 会话列表 / 建立 / 恢复 ----

const listSessions: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const session = yield* SessionService;
  return json(yield* session.listSessions(resolveCwd(rawCwd)));
});

const createSession: Handler = Effect.gen(function* () {
  const body = yield* readJson<{
    cwd: string;
    permissionMode: PermissionMode;
    model: string;
  }>();

  if (!isPermissionMode(body.permissionMode)) {
    return yield* Effect.fail(
      new AgentError('CONFIG_INVALID', `Invalid permissionMode: ${body.permissionMode}`)
    );
  }
  if (!body.model) {
    return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'model required'));
  }

  // 建会话即建立工作区：目录必须存在
  const cwd = resolveWorkspaceCwd(body.cwd);
  const session = yield* SessionService;
  const state = (yield* session.create(cwd, {
    model: body.model,
    permissionMode: body.permissionMode,
  })) as SessionStoreState;
  return json({ sessionId: state.sessionId });
});

const resumeSession: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string }>();
  const cwd = resolveCwd(body.cwd);
  const session = yield* SessionService;
  const state = yield* session.load(cwd, id ?? '');
  return json(yield* session.readHistory(state));
});

const compactSession: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; model?: string }>();
  const cwd = resolveCwd(body.cwd);
  const context = yield* ContextService;
  const session = yield* SessionService;
  const state = yield* session.load(cwd, id ?? '');
  return json(
    yield* context.compact(
      {
        cwd: state.cwd,
        sessionId: state.sessionId,
        parentSessionId: state.parentSessionId,
        currentTurnId: state.currentTurnId,
      },
      body.model ?? ''
    )
  );
});

const deleteSession: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const { cwd } = yield* query;
  if (!cwd) return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'cwd required'));

  const session = yield* SessionService;
  const context = yield* ContextService;
  const mailbox = yield* MailboxService;
  const turn = yield* TurnRegistryService;
  const todo = yield* TodoService;
  const sessionId = id ?? '';
  // 先请求停止：子代理纤维仍在跑的话，dispose 后它会成为孤儿（还会 mailbox.offer 重建队列）
  yield* turn.stopChildren(sessionId);
  yield* session.deleteSession(sessionId, cwd);
  yield* context.dispose(sessionId);
  yield* mailbox.dispose(sessionId);
  yield* todo.dispose(sessionId);
  yield* turn.dispose(sessionId);
  return json({ ok: true });
});

const sessionHistory: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const { cwd } = yield* query;
  if (!cwd) return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'cwd required'));
  const session = yield* SessionService;
  return json(yield* session.readUITurns(id ?? '', cwd));
});

const getPermissionMode: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const { cwd } = yield* query;
  if (!cwd) return json({ mode: ASK_BEFORE_EXEC_PERMISSION_MODE });
  const session = yield* SessionService;
  const state = yield* session.load(cwd, id ?? '');
  return json({ mode: state.permissionMode });
});

const setPermissionMode: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const { cwd, mode } = yield* readJson<{ cwd: string; mode: PermissionMode }>();
  if (!cwd) return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'cwd required'));
  if (!isPermissionMode(mode)) {
    return yield* Effect.fail(new AgentError('CONFIG_INVALID', `Invalid permissionMode: ${mode}`));
  }
  const session = yield* SessionService;
  yield* session.setPermissionMode(cwd, id ?? '', mode);
  return json({ ok: true });
});

// ---- Model switching ----
// :id 为 '_' 时切全局默认模型（写 config.yaml）；否则只写该会话头文件

const setModel: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd?: string; model?: string }>();
  const model = body.model?.trim();
  if (!model) return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'model required'));

  const sessionId = id ?? '';
  if (sessionId === '_' || !sessionId) {
    setGlobalActive(model);
    return json({ ok: true, activeId: activeModelId() });
  }

  const session = yield* SessionService;
  yield* session.setModel(resolveCwd(body.cwd), sessionId, model);
  return json({ ok: true });
});

const setTitle: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd?: string; title?: string }>();
  const title = body.title?.replace(/\n/g, ' ').trim();
  if (!title) return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'title required'));

  const cwd = resolveCwd(body.cwd);
  const session = yield* SessionService;
  const state = yield* session.load(cwd, id ?? '');
  yield* session.renameSession(state, title);
  return json({ ok: true });
});

// ---- Checkpoints / rollback ----

const latestCheckpointDiff: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const cwd = resolveCwd((yield* query).cwd);
  const checkpoint = yield* CheckpointService;
  return json(yield* checkpoint.getCheckpointDiff(cwd, id ?? ''));
});

const turnCheckpointDiff: Handler = Effect.gen(function* () {
  const { id, turnId: rawTurnId } = yield* pathParams;
  const cwd = resolveCwd((yield* query).cwd);
  const turnId = parseInt(rawTurnId ?? '', 10);
  const checkpoint = yield* CheckpointService;
  return json(
    yield* checkpoint.getCheckpointDiff(cwd, id ?? '', isNaN(turnId) ? undefined : turnId)
  );
});

// 'latest' 或缺省 = 不带 turnId，由服务端取最近一个有 checkpoint 的回合
function parseCheckpointTurnId(raw: string | undefined): number | undefined {
  if (!raw || raw === 'latest') return undefined;
  const n = parseInt(raw, 10);
  return isNaN(n) ? undefined : n;
}

const revertFile: Handler = Effect.gen(function* () {
  const { id, turnId: rawTurnId } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; file: string }>();
  const checkpoint = yield* CheckpointService;
  const result = yield* checkpoint.revertCheckpointFiles(
    resolveCwd(body.cwd),
    id ?? '',
    parseCheckpointTurnId(rawTurnId),
    [body.file]
  );
  return json({ ok: true, result });
});

const revertFiles: Handler = Effect.gen(function* () {
  const { id, turnId: rawTurnId } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; files: string[] }>();
  const checkpoint = yield* CheckpointService;
  const result = yield* checkpoint.revertCheckpointFiles(
    resolveCwd(body.cwd),
    id ?? '',
    parseCheckpointTurnId(rawTurnId),
    body.files
  );
  return json({ ok: true, result });
});

const undoRollback: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; files: string[] }>();
  const checkpoint = yield* CheckpointService;
  const result = yield* checkpoint.undoRollback(resolveCwd(body.cwd), id ?? '', body.files);
  return json({ ok: true, result });
});

const rollbackPreview: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const params = yield* query;
  const cwd = resolveCwd(params.cwd);
  const throughTurnId = parseInt(params.throughTurnId ?? '0', 10);
  const checkpoint = yield* CheckpointService;
  return json(yield* checkpoint.previewRollbackDiff(cwd, id ?? '', throughTurnId));
});

/** 回滚 context（+ 可选代码）后回吐新状态：turns / promptEstimate / usage 都要重算。 */
const rollbackState = (
  cwd: string,
  sessionId: string,
  throughTurnId: number,
  codeResult?: unknown
): Effect.Effect<unknown, AppError, any> =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const state = yield* session.load(cwd, sessionId);
    yield* session.rollbackToTurn(state, throughTurnId, 'user rollback');
    const turns = yield* session.readUITurns(sessionId, cwd);
    const promptEstimate = estimatePromptTokensFrom(yield* session.readHistory(state));
    return {
      ok: true,
      turns,
      promptEstimate,
      usage: state.usage,
      ...(codeResult ? { codeResult } : {}),
    };
  });

const rollbackContext: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; throughTurnId: number }>();
  return json(yield* rollbackState(resolveCwd(body.cwd), id ?? '', body.throughTurnId));
});

const rollbackBoth: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; throughTurnId: number }>();
  const cwd = resolveCwd(body.cwd);
  const sessionId = id ?? '';
  const checkpoint = yield* CheckpointService;
  const codeResult = yield* checkpoint.revertCheckpointFiles(
    cwd,
    sessionId,
    body.throughTurnId,
    []
  );
  return json(yield* rollbackState(cwd, sessionId, body.throughTurnId, codeResult));
});

const forkSession: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; atTurnId?: number }>();
  const cwd = resolveCwd(body.cwd);
  const session = yield* SessionService;
  const state = yield* session.load(cwd, id ?? '');
  const newSessionId = yield* session.forkSession(state, body.atTurnId ?? 0);
  const turns = yield* session.readUITurns(newSessionId, cwd);
  const newJsonlPath = computePaths(cwd, newSessionId).transcriptPath;
  const promptEstimate = estimatePromptTokensFrom(yield* session.readEvents(newJsonlPath));
  return json({ sessionId: newSessionId, turns, promptEstimate });
});

export const addSessionsRoutes = (router: Router): Router => {
  // 22 条路由，分两段 pipe —— 单个 pipe 的泛型重载上限是 20。
  const withCore = router.pipe(
    HttpRouter.get('/api/sessions', listSessions),
    HttpRouter.post('/api/sessions', createSession),
    HttpRouter.post('/api/sessions/:id/resume', resumeSession),
    HttpRouter.post('/api/sessions/:id/compact', compactSession),
    HttpRouter.del('/api/sessions/:id', deleteSession),
    HttpRouter.get('/api/sessions/:id/history', sessionHistory),
    HttpRouter.get('/api/sessions/:id/permission-mode', getPermissionMode),
    HttpRouter.put('/api/sessions/:id/permission-mode', setPermissionMode)
  );

  return withCore.pipe(
    HttpRouter.put('/api/sessions/:id/model', setModel),
    HttpRouter.put('/api/sessions/:id/title', setTitle),
    HttpRouter.get('/api/sessions/:id/checkpoints/latest/diff', latestCheckpointDiff),
    HttpRouter.get('/api/sessions/:id/checkpoints/:turnId/diff', turnCheckpointDiff),
    HttpRouter.post('/api/sessions/:id/checkpoints/:turnId/revert-file', revertFile),
    HttpRouter.post('/api/sessions/:id/checkpoints/:turnId/revert-files', revertFiles),
    HttpRouter.post('/api/sessions/:id/checkpoints/undo-rollback', undoRollback),
    HttpRouter.get('/api/sessions/:id/rollback-preview', rollbackPreview),
    HttpRouter.post('/api/sessions/:id/rollback-context', rollbackContext),
    HttpRouter.post('/api/sessions/:id/rollback-both-to-turn', rollbackBoth),
    HttpRouter.post('/api/sessions/:id/fork', forkSession)
  );
};
