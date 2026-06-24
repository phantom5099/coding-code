import { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { SessionStoreState, SessionMode } from '../../session/types.js';
import { SessionService } from '../../session/store.js';
import {
  getPermissionMode,
  deleteSession,
} from '../../session/file-ops.js';
import { computePaths } from '../../core/paths.js';
import { readUIHistory, findUserMessageForTurn } from '../../session/ui-history.js';
import { ContextService, estimatePromptTokens } from '../../context/service.js';
import { CheckpointService } from '../../checkpoint/checkpoint-service.js';
import { WorkspaceService } from '../../core/workspace.js';
import { LLMFactoryService } from '../../llm/factory.js';
import type { LLMClient } from '../../llm/client.js';
import { errorResponse } from '../util.js';
import { encodeProjectPath, getProjectBaseDir } from '../../core/path.js';
import { modeToProfile } from '../../runtime/project-runtime.js';
import { BUILD_PROFILE, PLAN_PROFILE } from '../../subagent/registry.js';
import { isPermissionMode, type PermissionMode } from '../../approval/types.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

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
    const body = (await c.req.json()) as {
      cwd: string;
      mode: SessionMode;
      permissionMode: PermissionMode;
      model: string;
    };
    if (body.mode !== 'plan' && body.mode !== 'build') {
      return c.json({ error: `Invalid mode: ${body.mode}` }, 400);
    }
    if (!isPermissionMode(body.permissionMode)) {
      return c.json({ error: `Invalid permissionMode: ${body.permissionMode}` }, 400);
    }
    if (!body.model) {
      return c.json({ error: 'model required' }, 400);
    }
    const normalizedCwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
    const result = await runWithLayer(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.createSessionWithProfile(normalizedCwd, {
          model: body.model,
          mode: body.mode,
          permissionMode: body.permissionMode,
        });
        return state;
      }) as any
    );
    if (!result.ok) {
      const { status, body: resp } = errorResponse(result.error);
      return c.json(resp, status as any);
    }
    return c.json({ sessionId: (result.value as SessionStoreState).sessionId });
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
        const state = yield* session.load(normalizedCwd, sessionId);
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
        const factory = yield* LLMFactoryService;
        const session = yield* SessionService;
        const state = yield* session.load(normalizedCwd, sessionId);

        let llm: LLMClient | null = null;
        const entry = yield* factory.getActiveEntry().pipe(Effect.either);
        if (entry._tag === 'Right') {
          const client = yield* factory.createClient(entry.right).pipe(Effect.either);
          if (client._tag === 'Right') llm = client.right;
        }

        const maxTokens = llm?.modelInfo.maxTokens ?? 128000;

        return yield* Effect.promise(() =>
          context.compactWithLLM(state.transcriptPath, maxTokens, llm)
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
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json({ error: 'cwd required' }, 400);
    deleteSession(sessionId, cwd);
    return c.json({ ok: true });
  });

  router.get('/:id/history', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json({ error: 'cwd required' }, 400);
    const turns = readUIHistory(sessionId, cwd);
    return c.json(turns);
  });

  // ---- Plan file: read the current plan document for a session ----
  // submit_plan writes a <slug(title)>.md file per submission, so the
  // "current" plan is whichever .md has the most recent mtime in the
  // project's plan directory.
  router.get('/:id/plan', async (c) => {
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(c.req.query('cwd'));
      })
    );
    const planDir = join(getProjectBaseDir(), encodeProjectPath(cwd));
    if (!existsSync(planDir)) {
      return c.json({
        content: '',
        path: '',
        directory: planDir,
        exists: false,
      });
    }
    let latest: { path: string; mtime: number } | null = null;
    for (const name of readdirSync(planDir)) {
      if (!name.endsWith('.md')) continue;
      const full = join(planDir, name);
      const mtime = statSync(full).mtimeMs;
      if (latest === null || mtime > latest.mtime) {
        latest = { path: full, mtime };
      }
    }
    if (latest === null) {
      return c.json({
        content: '',
        path: '',
        directory: planDir,
        exists: false,
      });
    }
    try {
      const content = readFileSync(latest.path, 'utf8');
      return c.json({
        content,
        path: latest.path,
        directory: planDir,
        exists: true,
      });
    } catch (e) {
      return c.json({ error: `Failed to read plan: ${String(e)}` }, 500);
    }
  });

  // ---- Plan/Build mode switching ----
  router.get('/:id/mode', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(c.req.query('cwd'));
      })
    );
    const result = await runWithLayer(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        return {
          mode: state.mode,
          permissionMode: state.permissionMode,
        };
      })
    );
    if (!result.ok) {
      const { status, body } = errorResponse(result.error);
      return c.json(body, status as any);
    }
    return c.json({
      ...result.value,
      cwd,
      available: [
        { name: PLAN_PROFILE.name, description: PLAN_PROFILE.description },
        { name: BUILD_PROFILE.name, description: BUILD_PROFILE.description },
      ],
    });
  });

  router.post('/:id/mode', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd?: string; mode: SessionMode };
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
    const mode = body.mode ?? 'build';
    if (mode !== 'plan' && mode !== 'build') {
      return c.json({ error: `Invalid mode: ${mode}` }, 400);
    }
    const result = await runWithLayer(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setModeOnDisk(cwd, sessionId, mode);
        const profile = modeToProfile(mode);
        yield* session.setActiveProfile(cwd, sessionId, profile.name);
        const state = yield* session.load(cwd, sessionId);
        return {
          mode: state.mode,
          permissionMode: state.permissionMode,
        };
      })
    );
    if (!result.ok) {
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }
    return c.json(result.value);
  });

  router.get('/:id/permission-mode', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json({ mode: 'default' });
    const idxPath = computePaths(cwd, sessionId).indexPath;
    if (!existsSync(idxPath)) return c.json({ mode: 'default' });
    const mode = getPermissionMode(idxPath);
    return c.json({ mode });
  });

  router.put('/:id/permission-mode', async (c) => {
    const sessionId = c.req.param('id');
    const { cwd, mode } = await c.req.json<{ cwd: string; mode: PermissionMode }>();
    if (!cwd) return c.json({ error: 'cwd required' }, 400);
    if (!isPermissionMode(mode)) {
      return c.json({ error: `Invalid permissionMode: ${mode}` }, 400);
    }
    const setResult = await runWithLayer(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setPermissionModeOnDisk(cwd, sessionId, mode);
        return { ok: true };
      }) as any
    );
    if (!setResult.ok) {
      const { status, body: errBody } = errorResponse(setResult.error);
      return c.json(errBody, status as any);
    }
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
        return yield* checkpoint.getCheckpointDiff(
          cwd,
          sessionId,
          isNaN(turnId) ? undefined : turnId
        );
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
        const state = yield* session.load(cwd, sessionId);
        const rolledBackMessage = findUserMessageForTurn(sessionId, body.throughTurnId, cwd);
        yield* session.rollbackToTurn(state, body.throughTurnId, 'user rollback');
        const turns = readUIHistory(sessionId, cwd);
        const promptEstimate = estimatePromptTokens(state.transcriptPath);
        const usage = state.usage;
        return { ok: true, turns, rolledBackMessage, promptEstimate, usage };
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
        const state = yield* session.load(cwd, sessionId);
        const rolledBackMessage = findUserMessageForTurn(sessionId, body.throughTurnId, cwd);
        yield* session.rollbackToTurn(state, body.throughTurnId, 'user rollback');
        const turns = readUIHistory(sessionId, cwd);
        const promptEstimate = estimatePromptTokens(state.transcriptPath);
        const usage = state.usage;
        return {
          ok: true,
          turns,
          codeResult,
          rolledBackMessage,
          promptEstimate,
          usage,
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
    const body = (await c.req.json()) as { cwd: string; atTurnId?: number };
    const cwd = await rt.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return ws.resolveWorkspaceCwd(body.cwd);
      })
    );
    const atTurnId = body.atTurnId ?? 0;
    const result = await runWithLayer(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        const newSessionId = yield* session.forkSession(state, atTurnId);
        const turns = readUIHistory(newSessionId, cwd);
        const newJsonlPath = computePaths(cwd, newSessionId).transcriptPath;
        const promptEstimate = estimatePromptTokens(newJsonlPath);
        return { sessionId: newSessionId, turns, promptEstimate };
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
