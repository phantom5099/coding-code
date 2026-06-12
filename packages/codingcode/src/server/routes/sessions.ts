import { Hono } from 'hono';
import { Effect } from 'effect';
import { join } from 'path';
import { SessionService, type SessionStoreState } from '../../session/store.js';
import {
  resolveSessionDir,
  getPermissionMode,
  setPermissionMode,
  readHistory,
  deleteSession,
} from '../../session/io.js';
import { readUIHistory } from '../../session/messages.js';
import { compactWithLLM } from '../../context/compressor.js';
import { getContextConfig } from '../../context/config.js';
import { CheckpointService } from '../../checkpoint/checkpoint-service.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';
import { runWithLayer, errorResponse } from '../util.js';

export const sessionsRouter = new Hono();

function findUserMessageForTurn(sessionId: string, turnId: number): string {
  const dir = resolveSessionDir(sessionId);
  if (!dir) return '';
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const rawEvents = readHistory(jsonlPath);
  for (const ev of rawEvents) {
    if (ev.type === 'user' && (ev as any).turnId === turnId) {
      return (ev as any).content ?? '';
    }
  }
  return '';
}

export const activeApprovalForks = new Map<
  string,
  { setPermissionMode: (mode: any) => Promise<void> | void }
>();

sessionsRouter.get('/', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const result = await runWithLayer(
    Effect.gen(function* () {
      const session = yield* SessionService;
      return yield* session.listSessions(cwd);
    }) as any
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.post('/', async (c) => {
  const body = (await c.req.json()) as { cwd: string; initialPermissionMode?: string };
  const normalizedCwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const session = yield* SessionService;
      return yield* session.create(normalizedCwd, 'unknown');
    }) as any
  );
  if (!result.ok) {
    const { status, body: resp } = errorResponse(result.error);
    return c.json(resp, status as any);
  }
  const state = result.value as SessionStoreState;
  if (body.initialPermissionMode) {
    const dir = resolveSessionDir(state.sessionId);
    if (dir) {
      const idxPath = join(dir, `${state.sessionId}.index.json`);
      setPermissionMode(state.sessionId, idxPath, body.initialPermissionMode);
    }
  }
  return c.json({ sessionId: state.sessionId });
});

sessionsRouter.post('/:id/resume', async (c) => {
  const sessionId = c.req.param('id');
  const body = (await c.req.json()) as { cwd: string };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const session = yield* SessionService;
      const state = yield* session.create(resolveWorkspaceCwd(body.cwd), 'unknown', sessionId);
      return yield* session.readHistory(state);
    }) as any
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.post('/:id/compact', async (c) => {
  const sessionId = c.req.param('id');
  const body = (await c.req.json()) as { cwd: string };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const session = yield* SessionService;
      const state = yield* session.create(resolveWorkspaceCwd(body.cwd), 'unknown', sessionId);
      return yield* Effect.promise(() =>
        compactWithLLM(state.sessionId, state.projectPath, getContextConfig(), null)
      );
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.delete('/:id', async (c) => {
  const sessionId = c.req.param('id');
  deleteSession(sessionId);
  return c.json({ ok: true });
});

sessionsRouter.get('/:id/history', async (c) => {
  const sessionId = c.req.param('id');
  const turns = readUIHistory(sessionId);
  return c.json(turns);
});

sessionsRouter.get('/:id/permission-mode', async (c) => {
  const sessionId = c.req.param('id');
  const dir = resolveSessionDir(sessionId);
  if (!dir) return c.json({ mode: 'default' });
  const idxPath = join(dir, `${sessionId}.index.json`);
  const mode = getPermissionMode(idxPath);
  return c.json({ mode });
});

sessionsRouter.put('/:id/permission-mode', async (c) => {
  const sessionId = c.req.param('id');
  const { mode } = await c.req.json<{ mode: string }>();
  const dir = resolveSessionDir(sessionId);
  if (!dir) return c.json({ error: 'Session not found' }, 404);
  const idxPath = join(dir, `${sessionId}.index.json`);
  setPermissionMode(sessionId, idxPath, mode);
  const handle = activeApprovalForks.get(sessionId);
  if (handle) handle.setPermissionMode(mode);
  return c.json({ ok: true });
});

sessionsRouter.get('/:id/rollback-state', async (c) => {
  const sessionId = c.req.param('id');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      const entry = yield* checkpoint.getLatestRestoreEntry(cwd, sessionId);
      return {
        context: { active: false, currentThroughTurnId: null },
        code: {
          canUndoLast: entry !== null,
          lastEntry: entry,
          revertedFiles: entry?.selectedFiles ?? [],
          lastEntryId: entry?.id ?? null,
        },
      };
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.get('/:id/checkpoints/latest/diff', async (c) => {
  const sessionId = c.req.param('id');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      return yield* checkpoint.getCheckpointDiff(cwd, sessionId);
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.get('/:id/checkpoints/:turnId/diff', async (c) => {
  const sessionId = c.req.param('id');
  const turnId = parseInt(c.req.param('turnId'), 10);
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      return yield* checkpoint.getCheckpointDiff(cwd, sessionId, isNaN(turnId) ? undefined : turnId);
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.post('/:id/checkpoints/latest/revert-file', async (c) => {
  const sessionId = c.req.param('id');
  const body = (await c.req.json()) as { cwd: string; file: string };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      const completedTurns = yield* checkpoint.getCompletedTurns(cwd, sessionId);
      if (completedTurns.length === 0)
        return {
          reverted: false,
          throughTurnId: 0,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        };
      const latestTurnId = completedTurns[completedTurns.length - 1]!;
      return yield* checkpoint.revertCheckpointFiles(cwd, sessionId, latestTurnId, [body.file]);
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

sessionsRouter.post('/:id/checkpoints/latest/revert-files', async (c) => {
  const sessionId = c.req.param('id');
  const body = (await c.req.json()) as { cwd: string; files: string[] };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      const completedTurns = yield* checkpoint.getCompletedTurns(cwd, sessionId);
      if (completedTurns.length === 0)
        return {
          reverted: false,
          throughTurnId: 0,
          affectedTurns: [],
          selectedFiles: [],
          restoreEntry: null,
        };
      const latestTurnId = completedTurns[completedTurns.length - 1]!;
      return yield* checkpoint.revertCheckpointFiles(cwd, sessionId, latestTurnId, body.files);
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

sessionsRouter.get('/:id/rollback-preview', async (c) => {
  const sessionId = c.req.param('id');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const throughTurnId = parseInt(c.req.query('throughTurnId') ?? '0', 10);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      return yield* checkpoint.previewRollbackDiff(cwd, sessionId, throughTurnId);
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.post('/:id/rollback-code-to-turn', async (c) => {
  const sessionId = c.req.param('id');
  const body = (await c.req.json()) as { cwd: string; throughTurnId: number };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      return yield* checkpoint.rollbackCodeToTurn(cwd, sessionId, body.throughTurnId);
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

sessionsRouter.post('/:id/rollback-context', async (c) => {
  const sessionId = c.req.param('id');
  const body = (await c.req.json()) as { cwd: string; throughTurnId: number };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const session = yield* SessionService;
      const state = yield* session.create(cwd, 'unknown', sessionId);
      const rolledBackMessage = findUserMessageForTurn(sessionId, body.throughTurnId);
      yield* session.rollbackToTurn(state, body.throughTurnId, 'user rollback');
      const turns = readUIHistory(sessionId);
      return { ok: true, turns, rolledBackMessage, promptEstimate: state.promptEstimate };
    }) as any
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.post('/:id/rollback-both-to-turn', async (c) => {
  const sessionId = c.req.param('id');
  const body = (await c.req.json()) as { cwd: string; throughTurnId: number };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const session = yield* SessionService;
      const checkpoint = yield* CheckpointService;
      const codeResult = yield* checkpoint.rollbackCodeToTurn(cwd, sessionId, body.throughTurnId);
      const state = yield* session.create(cwd, 'unknown', sessionId);
      const rolledBackMessage = findUserMessageForTurn(sessionId, body.throughTurnId);
      yield* session.rollbackToTurn(state, body.throughTurnId, 'user rollback');
      const turns = readUIHistory(sessionId);
      return {
        ok: true,
        turns,
        codeResult,
        rolledBackMessage,
        promptEstimate: state.promptEstimate,
      };
    }) as any
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.post('/:id/undo-code-rollback', async (c) => {
  const sessionId = c.req.param('id');
  const body = (await c.req.json()) as { cwd: string; force?: boolean; files?: string[] };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      return yield* checkpoint.undoLastCodeRollback(cwd, sessionId, {
        force: body.force,
        files: body.files,
      });
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

sessionsRouter.post('/:id/fork', async (c) => {
  const sessionId = c.req.param('id');
  const body = (await c.req.json()) as { cwd: string; atUuid?: string };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const session = yield* SessionService;
      const state = yield* session.create(cwd, 'unknown', sessionId);
      const newSessionId = yield* session.forkSession(state, body.atUuid ?? '');
      const turns = readUIHistory(newSessionId);
      return { sessionId: newSessionId, turns };
    }) as any
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});
