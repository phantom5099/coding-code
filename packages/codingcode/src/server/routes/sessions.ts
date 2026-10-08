import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { SessionStoreState } from '../../session/types.js';
import type { ProfileName } from '../../session/types.js';
import type { PermissionMode } from '../../session/types.js';

import { SessionService } from '../../session/port.js';
import { computePaths } from '../../session/paths.js';
import { ContextService } from '../../context/port.js';
import { MailboxService } from '../../session/mailbox.js';
import { estimatePromptTokensFrom } from '../../context/context.js';
import { CheckpointService } from '../../checkpoint/port.js';
import { activeModelId, setGlobalActive } from '../../infra/models.js';
import { createRunWithLayer, errorBody } from '../util.js';
import { resolveCwd, resolveWorkspaceCwd } from '../cwd.js';
import { projectDataDir } from '../../core/path.js';
import { AVAILABLE_PROFILES } from '../../session/types.js';
import { isAgentProfileName } from '../../agent/profile.js';
import { isPermissionMode } from '../../approval/types.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerSessionsRoutes(router: Hono, rt: ManagedRt): void {
  const runWithLayer = createRunWithLayer(rt);

  router.get('/api/sessions', async (c) => {
    const cwd = resolveCwd(c.req.query('cwd'));
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          return yield* session.listSessions(cwd);
        }) as any
      )
    );
  });

  router.post('/api/sessions', async (c) => {
    const body = (await c.req.json()) as {
      cwd: string;
      activeProfile: ProfileName;
      permissionMode: PermissionMode;
      model: string;
    };
    if (!isAgentProfileName(body.activeProfile)) {
      return c.json(
        errorBody('CONFIG_INVALID', `Invalid activeProfile: ${body.activeProfile}`),
        400
      );
    }
    if (!isPermissionMode(body.permissionMode)) {
      return c.json(
        errorBody('CONFIG_INVALID', `Invalid permissionMode: ${body.permissionMode}`),
        400
      );
    }
    if (!body.model) {
      return c.json(errorBody('CONFIG_MISSING', 'model required'), 400);
    }
    // 建会话即建立工作区：目录必须存在
    const normalizedCwd = resolveWorkspaceCwd(body.cwd);
    const state = (await runWithLayer(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.create(normalizedCwd, {
          model: body.model,
          activeProfile: body.activeProfile,
          permissionMode: body.permissionMode,
        });
      }) as any
    )) as SessionStoreState;
    return c.json({ sessionId: state.sessionId });
  });

  router.post('/api/sessions/:id/resume', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string };
    const normalizedCwd = resolveCwd(body.cwd);
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(normalizedCwd, sessionId);
          return yield* session.readHistory(state);
        }) as any
      )
    );
  });

  router.post('/api/sessions/:id/compact', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; model?: string };
    const normalizedCwd = resolveCwd(body.cwd);
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const context = yield* ContextService;
          const session = yield* SessionService;
          const state = yield* session.load(normalizedCwd, sessionId);
          return yield* context.compact(
            {
              cwd: state.cwd,
              sessionId: state.sessionId,
              parentSessionId: state.parentSessionId,
              currentTurnId: state.currentTurnId,
            },
            body.model ?? ''
          );
        })
      )
    );
  });

  router.delete('/api/sessions/:id', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json(errorBody('CONFIG_MISSING', 'cwd required'), 400);
    await runWithLayer(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const context = yield* ContextService;
        const mailbox = yield* MailboxService;
        yield* session.deleteSession(sessionId, cwd);
        yield* context.dispose(sessionId);
        yield* mailbox.dispose(sessionId);
      }) as any
    );
    return c.json({ ok: true });
  });

  router.get('/api/sessions/:id/history', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json(errorBody('CONFIG_MISSING', 'cwd required'), 400);
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          return yield* session.readUITurns(sessionId, cwd);
        }) as any
      )
    );
  });

  // ---- Plan file: read the current plan document for a session ----
  router.get('/api/sessions/:id/plan', async (c) => {
    const cwd = resolveCwd(c.req.query('cwd'));
    const planDir = projectDataDir(cwd);
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
      return c.json(errorBody('SESSION_IO_ERROR', `Failed to read plan: ${String(e)}`), 500);
    }
  });

  // ---- Agent profile switching ----
  router.get('/api/sessions/:id/profile', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = resolveCwd(c.req.query('cwd'));
    const value = await runWithLayer(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        return {
          activeProfile: state.activeProfile,
          permissionMode: state.permissionMode,
        };
      })
    );
    return c.json({
      ...value,
      cwd,
      available: AVAILABLE_PROFILES,
    });
  });

  router.post('/api/sessions/:id/profile', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd?: string; activeProfile: ProfileName };
    const cwd = resolveCwd(body.cwd);
    const activeProfile = body.activeProfile;
    if (!isAgentProfileName(activeProfile)) {
      return c.json(errorBody('CONFIG_INVALID', `Invalid activeProfile: ${activeProfile}`), 400);
    }
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          yield* session.setActiveProfile(cwd, sessionId, activeProfile);
          const state = yield* session.load(cwd, sessionId);
          return {
            activeProfile: state.activeProfile,
            permissionMode: state.permissionMode,
          };
        })
      )
    );
  });

  router.get('/api/sessions/:id/permission-mode', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json({ mode: 'askBeforeExec' });
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          return { mode: state.permissionMode };
        }) as any
      )
    );
  });

  router.put('/api/sessions/:id/permission-mode', async (c) => {
    const sessionId = c.req.param('id');
    const { cwd, mode } = await c.req.json<{ cwd: string; mode: PermissionMode }>();
    if (!cwd) return c.json(errorBody('CONFIG_MISSING', 'cwd required'), 400);
    if (!isPermissionMode(mode)) {
      return c.json(errorBody('CONFIG_INVALID', `Invalid permissionMode: ${mode}`), 400);
    }
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          yield* session.setPermissionMode(cwd, sessionId, mode);
          return { ok: true };
        }) as any
      )
    );
  });

  // ---- Model switching ----
  // :id 为 '_' 时切全局默认模型（写 config.yaml）；否则只写该会话头文件
  router.put('/api/sessions/:id/model', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd?: string; model?: string };
    const model = body.model?.trim();
    if (!model) return c.json(errorBody('CONFIG_MISSING', 'model required'), 400);

    if (sessionId === '_' || !sessionId) {
      setGlobalActive(model);
      return c.json({ ok: true, activeId: activeModelId() });
    }

    const cwd = resolveCwd(body.cwd);
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          yield* session.setModel(cwd, sessionId, model);
          return { ok: true };
        }) as any
      )
    );
  });

  router.put('/api/sessions/:id/title', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd?: string; title?: string };
    const title = body.title?.replace(/\n/g, ' ').trim();
    if (!title) return c.json(errorBody('CONFIG_MISSING', 'title required'), 400);
    const cwd = resolveCwd(body.cwd);
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          yield* session.renameSession(state, title);
          return { ok: true };
        }) as any
      )
    );
  });

  router.get('/api/sessions/:id/checkpoints/latest/diff', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = resolveCwd(c.req.query('cwd'));
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.getCheckpointDiff(cwd, sessionId);
        })
      )
    );
  });

  router.get('/api/sessions/:id/checkpoints/:turnId/diff', async (c) => {
    const sessionId = c.req.param('id');
    const turnId = parseInt(c.req.param('turnId'), 10);
    const cwd = resolveCwd(c.req.query('cwd'));
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.getCheckpointDiff(
            cwd,
            sessionId,
            isNaN(turnId) ? undefined : turnId
          );
        })
      )
    );
  });

  router.post('/api/sessions/:id/checkpoints/latest/revert-file', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; file: string };
    const cwd = resolveCwd(body.cwd);
    const result = await runWithLayer(
      Effect.gen(function* () {
        const checkpoint = yield* CheckpointService;
        return yield* checkpoint.revertCheckpointFiles(cwd, sessionId, undefined, [body.file]);
      })
    );
    return c.json({ ok: true, result });
  });

  router.post('/api/sessions/:id/checkpoints/latest/revert-files', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; files: string[] };
    const cwd = resolveCwd(body.cwd);
    const result = await runWithLayer(
      Effect.gen(function* () {
        const checkpoint = yield* CheckpointService;
        return yield* checkpoint.revertCheckpointFiles(cwd, sessionId, undefined, body.files);
      })
    );
    return c.json({ ok: true, result });
  });

  router.get('/api/sessions/:id/rollback-preview', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = resolveCwd(c.req.query('cwd'));
    const throughTurnId = parseInt(c.req.query('throughTurnId') ?? '0', 10);
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.previewRollbackDiff(cwd, sessionId, throughTurnId);
        })
      )
    );
  });

  router.post('/api/sessions/:id/rollback-code-to-turn', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; throughTurnId: number };
    const cwd = resolveCwd(body.cwd);
    const result = await runWithLayer(
      Effect.gen(function* () {
        const checkpoint = yield* CheckpointService;
        return yield* checkpoint.rollbackCodeToTurn(cwd, sessionId, body.throughTurnId);
      })
    );
    return c.json({ ok: true, result });
  });

  router.post('/api/sessions/:id/rollback-context', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; throughTurnId: number };
    const cwd = resolveCwd(body.cwd);
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          yield* session.rollbackToTurn(state, body.throughTurnId, 'user rollback');
          const turns = yield* session.readUITurns(sessionId, cwd);
          const promptEstimate = estimatePromptTokensFrom(yield* session.readHistory(state));
          const usage = state.usage;
          return { ok: true, turns, promptEstimate, usage };
        }) as any
      )
    );
  });

  router.post('/api/sessions/:id/rollback-both-to-turn', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; throughTurnId: number };
    const cwd = resolveCwd(body.cwd);
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const checkpoint = yield* CheckpointService;
          const codeResult = yield* checkpoint.rollbackCodeToTurn(
            cwd,
            sessionId,
            body.throughTurnId
          );
          const state = yield* session.load(cwd, sessionId);
          yield* session.rollbackToTurn(state, body.throughTurnId, 'user rollback');
          const turns = yield* session.readUITurns(sessionId, cwd);
          const promptEstimate = estimatePromptTokensFrom(yield* session.readHistory(state));
          const usage = state.usage;
          return {
            ok: true,
            turns,
            codeResult,
            promptEstimate,
            usage,
          };
        }) as any
      )
    );
  });

  router.post('/api/sessions/:id/fork', async (c) => {
    const sessionId = c.req.param('id');
    const body = (await c.req.json()) as { cwd: string; atTurnId?: number };
    const cwd = resolveCwd(body.cwd);
    const atTurnId = body.atTurnId ?? 0;
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, sessionId);
          const newSessionId = yield* session.forkSession(state, atTurnId);
          const turns = yield* session.readUITurns(newSessionId, cwd);
          const newJsonlPath = computePaths(cwd, newSessionId).transcriptPath;
          const promptEstimate = estimatePromptTokensFrom(yield* session.readEvents(newJsonlPath));
          return { sessionId: newSessionId, turns, promptEstimate };
        }) as any
      )
    );
  });
}
