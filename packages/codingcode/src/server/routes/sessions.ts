import { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { join } from 'path';
import { SessionService, type SessionStoreState } from '../../session/store.js';
import {
  resolveSessionDir,
  getPermissionMode,
  setPermissionMode,
  readHistory,
  deleteSession,
} from '../../session/file-ops.js';
import { readUIHistory } from '../../session/messages.js';
import { ContextService } from '../../context/service.js';
import { getContextConfig } from '../../context/config.js';
import { CheckpointService } from '../../checkpoint/checkpoint-service.js';
import { WorkspaceService } from '../../core/workspace.js';
import { errorResponse } from '../util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export const activeApprovalForks = new Map<
  string,
  { setPermissionMode: (mode: any) => Promise<void> | void }
>();

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

export function createSessionsRouter(rt: ManagedRt): Hono {
  const router = new Hono();
  const runWithLayer = async <A, E>(eff: Effect.Effect<A, E, any>) => {
    return rt.runPromise(
      eff.pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
          onFailure: (e) => ({ ok: false as const, error: e }),
        })
      )
    );
  };

  router.get('/', async (c) => {
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(c.req.query('cwd'));
      })
    );
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

  router.post('/', async (c) => {
    const body = (await c.req.json()) as { cwd: string; initialPermissionMode?: string };
    const normalizedCwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
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

  router.post('/:id/resume', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string };
    const normalizedCwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
    const result = await runWithLayer(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.create(normalizedCwd, 'unknown', sessionId);
        return yield* session.readHistory(state);
      }) as any
    );
    if (!result.ok) {
      const { status, body } = errorResponse(result.error);
      return c.json(body, status as any);
    }
    return c.json(result.value);
  });

  router.post('/:id/compact', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string };
    const normalizedCwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
    const result = await runWithLayer(
      Effect.gen(function* () {
        const context = yield* ContextService;
        const state = yield* (yield* SessionService).create(normalizedCwd, 'unknown', sessionId);
        return yield* Effect.promise(() =>
          context.compactWithLLM(state.sessionId, state.projectPath, getContextConfig(), null)
        );
      })
    );
    if (!result.ok) {
      const { status, body: resp } = errorResponse(result.error);
      return c.json(resp, status as any);
    }
    return c.json(result.value);
  });

  router.delete('/:id', async (c) => {
    const sessionId = c.req.param('id');
    deleteSession(sessionId);
    return c.json({ ok: true });
  });

  router.get('/:id/history', async (c) => {
    const sessionId = c.req.param('id');
    const turns = readUIHistory(sessionId);
    return c.json(turns);
  });

  router.get('/:id/permission-mode', async (c) => {
    const sessionId = c.req.param('id');
    const dir = resolveSessionDir(sessionId);
    if (!dir) return c.json({ mode: 'default' });
    const idxPath = join(dir, `${sessionId}.index.json`);
    const mode = getPermissionMode(idxPath);
    return c.json({ mode });
  });

  router.put('/:id/permission-mode', async (c) => {
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

  router.get('/:id/rollback-state', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(c.req.query('cwd'));
      })
    );
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

  router.get('/:id/checkpoints/latest/diff', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(c.req.query('cwd'));
      })
    );
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

  router.get('/:id/checkpoints/:turnId/diff', async (c) => {
    const sessionId = c.req.param('id');
    const turnId = parseInt(c.req.param('turnId'), 10);
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(c.req.query('cwd'));
      })
    );
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

  router.post('/:id/checkpoints/latest/revert-file', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; file: string };
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
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
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }
    return c.json({ ok: true, result: result.value });
  });

  router.post('/:id/checkpoints/latest/revert-files', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; files: string[] };
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
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
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }
    return c.json({ ok: true, result: result.value });
  });

  router.get('/:id/rollback-preview', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(c.req.query('cwd'));
      })
    );
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

  router.post('/:id/rollback-code-to-turn', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; throughTurnId: number };
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
    const result = await runWithLayer(
      Effect.gen(function* () {
        const checkpoint = yield* CheckpointService;
        return yield* checkpoint.rollbackCodeToTurn(cwd, sessionId, body.throughTurnId);
      })
    );
    if (!result.ok) {
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }
    return c.json({ ok: true, result: result.value });
  });

  router.post('/:id/rollback-context', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; throughTurnId: number };
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
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
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }
    return c.json(result.value);
  });

  router.post('/:id/rollback-both-to-turn', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; throughTurnId: number };
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
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
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }
    return c.json(result.value);
  });

  router.post('/:id/undo-code-rollback', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; force?: boolean; files?: string[] };
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
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
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }
    return c.json({ ok: true, result: result.value });
  });

  router.post('/:id/fork', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; atUuid?: string };
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
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
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }
    return c.json(result.value);
  });

  return router;
}
