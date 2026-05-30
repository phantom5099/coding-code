import { Hono } from 'hono';
import { Effect } from 'effect';
import { join } from 'path';
import { SessionService, resolveSessionDir, getPermissionMode, setPermissionMode, readUIHistory, readHistory } from '../../session/store.js';
import { ContextService } from '../../context/context.js';
import { CheckpointService } from '../../checkpoint/checkpoint-service.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';
import { deleteSession } from '../../session/store.js';
import { runWithLayer, errorResponse } from '../util.js';

export const sessionsRouter = new Hono();

// ---- C0: Existing routes ----

sessionsRouter.get('/', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.listSessions(cwd);
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.post('/', async (c) => {
  const body = await c.req.json() as { cwd: string; initialPermissionMode?: string };
  const normalizedCwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(normalizedCwd, 'unknown', '0.1.0');
    }),
  );
  if (!result.ok) {
    const { status, body: resp } = errorResponse(result.error);
    return c.json(resp, status as any);
  }
  const state = result.value;
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
  const body = await c.req.json() as { cwd: string };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      const state = yield* svc.create(resolveWorkspaceCwd(body.cwd), 'unknown', '0.1.0', sessionId);
      return yield* svc.readHistory(state);
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

sessionsRouter.post('/:id/compact', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      const ctx = yield* ContextService;
      const state = yield* svc.create(resolveWorkspaceCwd(body.cwd), 'unknown', '0.1.0', sessionId);
      return yield* ctx.compress(state.sessionId, state.projectPath, null);
    }),
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

// C1: history (now with visibility filtering applied via readUIHistory)
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
  return c.json({ ok: true });
});

// ---- C2: rollback state ----

sessionsRouter.get('/:id/rollback-state', async (c) => {
  const sessionId = c.req.param('id');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      const entry = checkpoint.getLatestRestoreEntry(cwd, sessionId);
      return {
        context: { active: false, currentThroughTurnId: null },
        code: {
          canUndoLast: entry !== null,
          lastEntry: entry,
          revertedFiles: entry?.selectedFiles ?? [],
          lastEntryId: entry?.id ?? null,
        },
      };
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

// ---- C3: checkpoint diff (latest or by turn) ----

sessionsRouter.get('/:id/checkpoints/latest/diff', async (c) => {
  const sessionId = c.req.param('id');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      return checkpoint.getCheckpointDiff(cwd, sessionId);
    }),
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
      return checkpoint.getCheckpointDiff(cwd, sessionId, isNaN(turnId) ? undefined : turnId);
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

// ---- C4: revert single file ----

sessionsRouter.post('/:id/checkpoints/latest/revert-file', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string; file: string };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      const completedTurns = checkpoint.getCompletedTurns(cwd, sessionId);
      if (completedTurns.length === 0) return { reverted: false, throughTurnId: 0, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
      const latestTurnId = completedTurns[completedTurns.length - 1]!;
      return checkpoint.revertCheckpointFile(cwd, sessionId, latestTurnId, body.file);
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

// ---- C5: revert multiple files ----

sessionsRouter.post('/:id/checkpoints/latest/revert-files', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string; files: string[] };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      const completedTurns = checkpoint.getCompletedTurns(cwd, sessionId);
      if (completedTurns.length === 0) return { reverted: false, throughTurnId: 0, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
      const latestTurnId = completedTurns[completedTurns.length - 1]!;
      return checkpoint.revertCheckpointFiles(cwd, sessionId, latestTurnId, body.files);
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

// ---- C6: revert agent files ----

sessionsRouter.post('/:id/checkpoints/latest/revert-agent', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      const completedTurns = checkpoint.getCompletedTurns(cwd, sessionId);
      if (completedTurns.length === 0) return { reverted: false, throughTurnId: 0, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
      const latestTurnId = completedTurns[completedTurns.length - 1]!;
      return checkpoint.revertCheckpointAgentFiles(cwd, sessionId, latestTurnId);
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

// ---- C7: revert all files ----

sessionsRouter.post('/:id/checkpoints/latest/revert-all', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      const completedTurns = checkpoint.getCompletedTurns(cwd, sessionId);
      if (completedTurns.length === 0) return { reverted: false, throughTurnId: 0, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
      const latestTurnId = completedTurns[completedTurns.length - 1]!;
      return checkpoint.revertCheckpointAllFiles(cwd, sessionId, latestTurnId);
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

// ---- C8: rollback preview diff ----

sessionsRouter.get('/:id/rollback-preview', async (c) => {
  const sessionId = c.req.param('id');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const throughTurnId = parseInt(c.req.query('throughTurnId') ?? '0', 10);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      return checkpoint.previewRollbackDiff(cwd, sessionId, throughTurnId);
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

// ---- C9: rollback code to turn ----

sessionsRouter.post('/:id/rollback-code-to-turn', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string; throughTurnId: number };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      return checkpoint.rollbackCodeToTurn(cwd, sessionId, body.throughTurnId);
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

// ---- C10: rollback context ----

sessionsRouter.post('/:id/rollback-context', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string; throughTurnId: number };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      const state = yield* svc.create(cwd, 'unknown', '0.1.0', sessionId);
      yield* svc.rollbackToTurn(state, body.throughTurnId, 'user rollback');
      const turns = readUIHistory(sessionId);
      // Find user message of the rolled-back turn for input refill
      let rolledBackMessage = '';
      const dir = resolveSessionDir(sessionId);
      if (dir) {
        const jsonlPath = join(dir, `${sessionId}.jsonl`);
        const rawEvents = readHistory(jsonlPath);
        for (const ev of rawEvents) {
          if (ev.type === 'user' && (ev as any).turnId === body.throughTurnId) {
            rolledBackMessage = (ev as any).content ?? '';
            break;
          }
        }
      }
      return { ok: true, turns, rolledBackMessage };
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

// ---- C11: rollback both ----

sessionsRouter.post('/:id/rollback-both-to-turn', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string; throughTurnId: number };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      const svc = yield* SessionService;
      const codeResult = checkpoint.rollbackCodeToTurn(cwd, sessionId, body.throughTurnId);
      const state = yield* svc.create(cwd, 'unknown', '0.1.0', sessionId);
      yield* svc.rollbackToTurn(state, body.throughTurnId, 'user rollback');
      const turns = readUIHistory(sessionId);
      return { ok: true, turns, codeResult };
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

// ---- C12: undo code rollback ----

sessionsRouter.post('/:id/undo-code-rollback', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string; force?: boolean; files?: string[] };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const checkpoint = yield* CheckpointService;
      return checkpoint.undoLastCodeRollback(cwd, sessionId, { force: body.force, files: body.files });
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ ok: true, result: result.value });
});

// ---- C13: undo context rollback — intentionally NOT implemented ----

// ---- C14: fork ----

sessionsRouter.post('/:id/fork', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string; atUuid?: string };
  const cwd = resolveWorkspaceCwd(body.cwd);
  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      const state = yield* svc.create(cwd, 'unknown', '0.1.0', sessionId);
      const newSessionId = yield* svc.forkSession(state, body.atUuid ?? '');
      const turns = readUIHistory(newSessionId);
      return { sessionId: newSessionId, turns };
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});
