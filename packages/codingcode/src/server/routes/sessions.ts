import { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { existsSync } from 'fs';
import type { SessionStoreState } from '../../session/types.js';
import { SessionService } from '../../session/store.js';
import {
  sessionJsonlPathFromCwd,
  getPermissionMode,
  setPermissionMode,
  readHistory,
  deleteSession,
} from '../../session/file-ops.js';
import type { SessionEvent, SummaryEvent, CompactEvent } from '../../session/types.js';
import { ContextService, estimatePromptTokens } from '../../context/service.js';
import { CheckpointService } from '../../checkpoint/checkpoint-service.js';
import { WorkspaceService } from '../../core/workspace.js';
import { LLMFactoryService } from '../../llm/factory.js';
import type { LLMClient } from '../../llm/client.js';
import { errorResponse } from '../util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export const activeApprovalForks = new Map<
  string,
  { setPermissionMode: (mode: any) => Promise<void> | void }
>();

// --- UI history functions (moved from messages.ts) ---

function filterForUI(events: SessionEvent[]): SessionEvent[] {
  const rollbackHiddenTurnIds = new Set<number>();
  const rollbackHiddenOpUuids = new Set<string>();

  for (const ev of events) {
    if (ev.type !== 'rollback') continue;
    for (const prior of events) {
      if (prior === ev) break;
      if ('turnId' in prior && prior.turnId >= ev.throughTurnId) {
        rollbackHiddenTurnIds.add(prior.turnId);
      }
      if (prior.type === 'summary' || prior.type === 'compact') {
        if ((prior as SummaryEvent | CompactEvent).endTurnId >= ev.throughTurnId) {
          rollbackHiddenOpUuids.add((prior as SummaryEvent | CompactEvent).uuid);
        }
      }
    }
  }

  return events.filter((ev) => {
    if (ev.type === 'rollback') return false;
    if (ev.type === 'summary' && rollbackHiddenOpUuids.has((ev as SummaryEvent).uuid)) return false;
    if (ev.type === 'compact' && rollbackHiddenOpUuids.has((ev as CompactEvent).uuid)) return false;
    if ('turnId' in ev && rollbackHiddenTurnIds.has(ev.turnId)) return false;
    return true;
  }) as SessionEvent[];
}

function createTurnScopedIdGenerator() {
  const counters = new Map<string, number>();
  return (prefix: string, turnId: number): string => {
    const key = `${prefix}:${turnId}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return `${prefix}-${turnId}-${next}`;
  };
}

function sessionEventsToTurns(
  events: SessionEvent[]
): Array<{ id: string; items: object[]; status: string }> {
  const turnsMap = new Map<number, { id: string; items: object[]; status: string }>();
  const nextId = createTurnScopedIdGenerator();

  for (const event of events) {
    if (event.type === 'session_meta') continue;
    if (event.type === 'compact' || event.type === 'rollback') continue;

    if (event.type === 'summary') {
      let turn = turnsMap.get(event.endTurnId);
      if (!turn) {
        turn = { id: String(event.endTurnId), items: [], status: 'completed' };
        turnsMap.set(event.endTurnId, turn);
      }
      turn.items.push({
        id: `summary-${event.uuid}`,
        type: 'summary',
        content: event.summaryText,
        startTurnId: event.startTurnId,
        endTurnId: event.endTurnId,
      });
      continue;
    }

    let turn = turnsMap.get(event.turnId);
    if (!turn) {
      turn = { id: String(event.turnId), items: [], status: 'completed' };
      turnsMap.set(event.turnId, turn);
    }
    switch (event.type) {
      case 'user':
        turn.items.push({
          id: nextId('user', event.turnId),
          type: 'message',
          role: 'user',
          content: event.content,
        });
        break;
      case 'assistant':
        if (event.content) {
          turn.items.push({
            id: nextId('assistant', event.turnId),
            type: 'message',
            role: 'assistant',
            content: event.content,
          });
        }
        for (const tc of event.toolCalls ?? []) {
          const args = tc.arguments ?? {};
          turn.items.push({
            id: tc.id,
            type: 'tool_call',
            name: tc.name,
            args,
            status: 'approved',
          });
        }
        break;
      case 'tool_result': {
        const item: Record<string, unknown> = {
          id: `result-${event.toolCallId}`,
          type: 'tool_result',
          callId: event.toolCallId,
          name: event.toolName,
          output: event.output,
        };
        turn.items.push(item);
        break;
      }
    }
  }
  return [...turnsMap.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

function readUIHistory(
  sessionId: string,
  cwd: string
): Array<{ id: string; items: object[]; status: string }> {
  const jsonlPath = sessionJsonlPathFromCwd(cwd, sessionId);
  if (!existsSync(jsonlPath)) return [];
  const events = readHistory(jsonlPath);
  const visibleEvents = filterForUI(events);
  return sessionEventsToTurns(visibleEvents);
}

function findUserMessageForTurn(sessionId: string, turnId: number, cwd: string): string {
  const jsonlPath = sessionJsonlPathFromCwd(cwd, sessionId);
  if (!existsSync(jsonlPath)) return '';
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
      setPermissionMode(state.sessionId, state.indexPath, body.initialPermissionMode);
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
          context.compactWithLLM(state.sessionId, state.projectPath, maxTokens, llm)
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

  router.get('/:id/permission-mode', async (c) => {
    const sessionId = c.req.param('id');
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json({ mode: 'default' });
    const idxPath = sessionJsonlPathFromCwd(cwd, sessionId).replace('.jsonl', '.index.json');
    if (!existsSync(idxPath)) return c.json({ mode: 'default' });
    const mode = getPermissionMode(idxPath);
    return c.json({ mode });
  });

  router.put('/:id/permission-mode', async (c) => {
    const sessionId = c.req.param('id');
    const { cwd, mode } = await c.req.json<{ cwd: string; mode: string }>();
    if (!cwd) return c.json({ error: 'cwd required' }, 400);
    const idxPath = sessionJsonlPathFromCwd(cwd, sessionId).replace('.jsonl', '.index.json');
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
        return { ok: true, turns, rolledBackMessage, promptEstimate };
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
        return {
          ok: true,
          turns,
          codeResult,
          rolledBackMessage,
          promptEstimate,
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
        const newJsonlPath = sessionJsonlPathFromCwd(cwd, newSessionId);
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
