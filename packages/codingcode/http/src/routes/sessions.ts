import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import {
  AgentError,
  ASK_BEFORE_EXEC_PERMISSION_MODE,
  isPermissionMode,
  type PermissionMode,
} from '@codingcode/util';
import { MailboxService } from '@codingcode/mailbox';
import {
  SessionService,
  sessionRefOf,
  type SessionKey,
} from '@codingcode/session';
import { ContextService, estimatePromptTokensFrom } from '@codingcode/context';
import { TurnRegistryService } from '@codingcode/turn';
import { TodoService } from '@codingcode/todo';
import { CheckpointService, type CodeRollbackResult } from '@codingcode/checkpoint';
import { activeModelId, setGlobalActive } from '@codingcode/model';
import {
  NEW_SESSION_SENTINEL,
  resolveCwd,
  resolveWorkspaceCwd,
  sessionKeyOf,
} from '../cwd.js';
import { json, pathParams, query, readJson, type Handler, type Router } from '../handler.js';
import type { ForkResult, RollbackBothResult, RollbackContextResult } from '../dto.js';
import type { AppError } from '../http-error.js';

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

  const cwd = resolveWorkspaceCwd(body.cwd);
  const session = yield* SessionService;
  const state = yield* session.create({
    cwd,
    model: body.model,
    permissionMode: body.permissionMode,
  });
  return json({ sessionId: state.sessionId });
});

const resumeSession: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string }>();
  const session = yield* SessionService;
  const state = yield* session.load(sessionKeyOf(id, body.cwd));
  return json(yield* session.readHistory(state));
});

const compactSession: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; model?: string }>();
  const context = yield* ContextService;
  const session = yield* SessionService;
  const state = yield* session.load(sessionKeyOf(id, body.cwd));
  return json(yield* context.compact({ session: sessionRefOf(state), model: body.model ?? '' }));
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
  yield* turn.stopChildren(sessionId);
  yield* session.deleteSession({ cwd, sessionId });
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
  return json(yield* session.readUITurns({ cwd, sessionId: id ?? '' }));
});

const getPermissionMode: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const { cwd } = yield* query;
  if (!cwd) return json({ mode: ASK_BEFORE_EXEC_PERMISSION_MODE });
  const session = yield* SessionService;
  const state = yield* session.load({ cwd, sessionId: id ?? '' });
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
  yield* session.setPermissionMode({ cwd, sessionId: id ?? '' }, mode);
  return json({ ok: true });
});

const setModel: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd?: string; model?: string }>();
  const model = body.model?.trim();
  if (!model) return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'model required'));

  const sessionId = id ?? '';
  if (sessionId === NEW_SESSION_SENTINEL || !sessionId) {
    setGlobalActive(model);
    return json({ ok: true, activeId: activeModelId() });
  }

  const session = yield* SessionService;
  yield* session.setModel(sessionKeyOf(sessionId, body.cwd), model);
  return json({ ok: true });
});

const setTitle: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd?: string; title?: string }>();
  const title = body.title?.replace(/\n/g, ' ').trim();
  if (!title) return yield* Effect.fail(new AgentError('CONFIG_MISSING', 'title required'));

  const session = yield* SessionService;
  const state = yield* session.load(sessionKeyOf(id, body.cwd));
  yield* session.renameSession(state, title);
  return json({ ok: true });
});

// ---- Checkpoints / rollback ----

function parseCheckpointTurnId(raw: string | undefined): number | undefined {
  if (!raw || raw === 'latest') return undefined;
  const n = parseInt(raw, 10);
  return isNaN(n) ? undefined : n;
}

const latestCheckpointDiff: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const checkpoint = yield* CheckpointService;
  return json(yield* checkpoint.getCheckpointDiff(sessionKeyOf(id, (yield* query).cwd)));
});

const turnCheckpointDiff: Handler = Effect.gen(function* () {
  const { id, turnId: rawTurnId } = yield* pathParams;
  const checkpoint = yield* CheckpointService;
  return json(
    yield* checkpoint.getCheckpointDiff(
      sessionKeyOf(id, (yield* query).cwd),
      parseCheckpointTurnId(rawTurnId)
    )
  );
});

const revertFile: Handler = Effect.gen(function* () {
  const { id, turnId: rawTurnId } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; file: string }>();
  const checkpoint = yield* CheckpointService;
  const result = yield* checkpoint.revertCheckpointFiles({
    target: sessionKeyOf(id, body.cwd),
    turnId: parseCheckpointTurnId(rawTurnId),
    files: [body.file],
  });
  return json({ ok: true, result });
});

const revertFiles: Handler = Effect.gen(function* () {
  const { id, turnId: rawTurnId } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; files: string[] }>();
  const checkpoint = yield* CheckpointService;
  const result = yield* checkpoint.revertCheckpointFiles({
    target: sessionKeyOf(id, body.cwd),
    turnId: parseCheckpointTurnId(rawTurnId),
    files: body.files,
  });
  return json({ ok: true, result });
});

const undoRollback: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; files: string[] }>();
  const checkpoint = yield* CheckpointService;
  const result = yield* checkpoint.undoRollback(sessionKeyOf(id, body.cwd), body.files);
  return json({ ok: true, result });
});

const rollbackPreview: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const params = yield* query;
  const throughTurnId = parseInt(params.throughTurnId ?? '0', 10);
  const checkpoint = yield* CheckpointService;
  return json(yield* checkpoint.previewRollbackDiff(sessionKeyOf(id, params.cwd), throughTurnId));
});

/** 回滚 context 后回吐新状态：turns / promptEstimate / usage 都要重算 */
const rollbackState = (cmd: {
  readonly locator: SessionKey;
  readonly throughTurnId: number;
}): Effect.Effect<RollbackContextResult, AppError, SessionService> =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const state = yield* session.load(cmd.locator);
    yield* session.rollbackToTurn(state, {
      throughTurnId: cmd.throughTurnId,
      reason: 'user rollback',
    });
    const turns = yield* session.readUITurns(cmd.locator);
    const promptEstimate = estimatePromptTokensFrom(yield* session.readHistory(state));
    return {
      ok: true as const,
      turns,
      promptEstimate,
      usage: state.usage,
    };
  });

const rollbackContext: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; throughTurnId: number }>();
  return json(
    yield* rollbackState({ locator: sessionKeyOf(id, body.cwd), throughTurnId: body.throughTurnId })
  );
});

const rollbackBoth: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; throughTurnId: number }>();
  const locator = sessionKeyOf(id, body.cwd);
  const checkpoint = yield* CheckpointService;
  const codeResult: CodeRollbackResult = yield* checkpoint.revertCheckpointFiles({
    target: locator,
    turnId: body.throughTurnId,
    files: [],
  });
  const base = yield* rollbackState({ locator, throughTurnId: body.throughTurnId });
  const result: RollbackBothResult = { ...base, codeResult };
  return json(result);
});

const forkSession: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<{ cwd: string; atTurnId?: number }>();
  const cwd = resolveCwd(body.cwd);
  const session = yield* SessionService;
  const state = yield* session.load({ cwd, sessionId: id ?? '' });
  const newSessionId = yield* session.forkSession(state, body.atTurnId ?? 0);
  const forkedKey: SessionKey = { cwd, sessionId: newSessionId };
  const turns = yield* session.readUITurns(forkedKey);
  const promptEstimate = estimatePromptTokensFrom(yield* session.readEvents(forkedKey));
  const result: ForkResult = { sessionId: newSessionId, turns, promptEstimate };
  return json(result);
});

export const addSessionsRoutes = (router: Router): Router => {
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
