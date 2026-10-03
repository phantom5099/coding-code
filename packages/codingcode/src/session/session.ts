import { Effect, Layer } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { AgentError } from '../core/error.js';
import { encodeProjectPath } from '../core/path.js';
import { computePaths } from './paths.js';
import type { SessionMetaEvent, UserEvent, AssistantEvent, ToolResultEvent, SummaryEvent, RollbackEvent, SessionEvent, SessionStoreState, SessionSummary, CompactEvent, UITurn } from '../contracts/session.js';
import type { TokenUsage, ProfileName } from '../contracts/types.js';
import type { PermissionMode } from '../contracts/permission.js';
import { SessionService } from './port.js';
import {
  ensureDirs,
  readHistory,
  appendLine,
  listSessions,
  readSessionMeta,
  rewriteSessionMeta,
  readLastTurnId,
  readLastUsage,
  truncateTitle,
  deleteSession as deleteSessionImpl,
  sessionJsonlPathFromCwd,
} from './file-ops.js';

function pathsFromState(state: SessionStoreState) {
  return computePaths(state.cwd, state.sessionId, state.parentSessionId);
}

function assertResumeWorkspace(cwd: string, sessionId: string, parentSessionId?: string): void {
  const expectedPath = sessionJsonlPathFromCwd(cwd, sessionId, parentSessionId);
  if (!existsSync(expectedPath)) throw AgentError.sessionNotFound(sessionId);
}

// --- UI history (moved from ui-history.ts) ---

export function filterForUI(events: SessionEvent[]): SessionEvent[] {
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

export function sessionEventsToTurns(events: SessionEvent[]): UITurn[] {
  const turnsMap = new Map<number, UITurn>();
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
        if (event.source === 'system') break;
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
        turn.items.push({
          id: `result-${event.toolCallId}`,
          type: 'tool_result',
          callId: event.toolCallId,
          name: event.toolName,
          output: event.output,
        });
        break;
      }
    }
  }
  return [...turnsMap.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

function readUIHistory(sessionId: string, cwd: string): UITurn[] {
  const jsonlPath = sessionJsonlPathFromCwd(cwd, sessionId);
  if (!existsSync(jsonlPath)) return [];
  const events = readHistory(jsonlPath);
  const visibleEvents = filterForUI(events);
  return sessionEventsToTurns(visibleEvents);
}

export const SessionLayer = Layer.effect(
  SessionService,
  Effect.gen(function* () {
    const create = (
      cwd: string,
      options: {
        model: string;
        title?: string;
        activeProfile: ProfileName;
        permissionMode: PermissionMode;
      },
      opts?: { parentSessionId?: string; agentName?: string }
    ): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          const paths = computePaths(cwd, randomUUID(), opts?.parentSessionId);
          ensureDirs(paths.transcriptPath);

          const meta: SessionMetaEvent = {
            type: 'session_meta',
            sessionId: paths.sessionId,
            cwd: paths.cwd,
            createdAt: new Date().toISOString(),
            model: options.model,
            title: options.title ? truncateTitle(options.title) : paths.sessionId.slice(0, 8),
            activeProfile: options.activeProfile,
            permissionMode: options.permissionMode,
            ...(opts?.parentSessionId && { parentSessionId: opts.parentSessionId }),
            ...(opts?.agentName && { agentName: opts.agentName }),
          };
          appendLine(paths.transcriptPath, meta);

          return { ...meta, currentTurnId: 0, memorySnapshot: '', usage: undefined };
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const load = (cwd: string, sessionId: string, parentSessionId?: string): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          assertResumeWorkspace(cwd, sessionId, parentSessionId);
          const paths = computePaths(cwd, sessionId, parentSessionId);
          ensureDirs(paths.transcriptPath);

          const meta = readSessionMeta(paths.transcriptPath);
          if (!meta) throw new Error('Session file missing session_meta');

          return {
            ...meta,
            currentTurnId: readLastTurnId(paths.transcriptPath),
            memorySnapshot: '',
            usage: readLastUsage(paths.transcriptPath),
          };
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session load failed: ${String(e)}`, e),
      });

    const recordUser = (
      state: SessionStoreState,
      content: string
    ): Effect.Effect<UserEvent, AgentError> =>
      Effect.try({
        try: () => {
          state.currentTurnId += 1;
          const event: UserEvent = {
            type: 'user',
            turnId: state.currentTurnId,
            content,
            source: 'user',
          };
          appendLine(pathsFromState(state).transcriptPath, event);
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const recordSystem = (
      state: SessionStoreState,
      content: string
    ): Effect.Effect<UserEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: UserEvent = {
            type: 'user',
            turnId: state.currentTurnId,
            content,
            source: 'system',
          };
          appendLine(pathsFromState(state).transcriptPath, event);
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const recordAssistant = (
      state: SessionStoreState,
      content: string,
      toolCalls: AssistantEvent['toolCalls'],
      usage?: TokenUsage
    ): Effect.Effect<AssistantEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: AssistantEvent = {
            type: 'assistant',
            turnId: state.currentTurnId,
            content,
            toolCalls,
            usage,
          };
          appendLine(pathsFromState(state).transcriptPath, event);
          if (usage) {
            state.usage = usage;
          }
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const recordToolResult = (
      state: SessionStoreState,
      toolName: string,
      toolCallId: string,
      output: string
    ): Effect.Effect<ToolResultEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: ToolResultEvent = {
            type: 'tool_result',
            turnId: state.currentTurnId,
            toolName,
            toolCallId,
            output,
          };
          appendLine(pathsFromState(state).transcriptPath, event);
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const appendSummary = (
      state: SessionStoreState,
      summaryText: string,
      startTurnId: number,
      endTurnId: number
    ): Effect.Effect<SummaryEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: SummaryEvent = {
            type: 'summary',
            uuid: randomUUID(),
            startTurnId,
            endTurnId,
            summaryText,
          };
          appendLine(pathsFromState(state).transcriptPath, event);
          state.usage = undefined;
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const rollbackToTurn = (
      state: SessionStoreState,
      throughTurnId: number,
      reason: string
    ): Effect.Effect<RollbackEvent, AgentError> =>
      Effect.sync(() => {
        const event: RollbackEvent = {
          type: 'rollback',
          throughTurnId,
          reason,
        };
        const transcriptPath = pathsFromState(state).transcriptPath;
        appendLine(transcriptPath, event);
        state.usage = readLastUsage(transcriptPath);

        return event;
      });

    const forkSession = (
      state: SessionStoreState,
      atTurnId: number
    ): Effect.Effect<string, AgentError> =>
      Effect.sync(() => {
        return forkSessionImpl(pathsFromState(state).transcriptPath, atTurnId);
      });

    const renameSession = (
      state: SessionStoreState,
      text: string
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        state.title = text;
        rewriteSessionMeta(pathsFromState(state).transcriptPath, { title: text });
      });

    const readHistoryFromState = (state: SessionStoreState): Effect.Effect<SessionEvent[]> =>
      Effect.sync(() => readHistory(pathsFromState(state).transcriptPath));

    const listSessionsFromCwd = (cwd?: string): Effect.Effect<SessionSummary[]> =>
      Effect.sync(() => listSessions(cwd ? encodeProjectPath(cwd) : undefined));

    const setPermissionModeByAddress = (
      cwd: string,
      sessionId: string,
      mode: PermissionMode,
      parentSessionId?: string
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId, parentSessionId);
        rewriteSessionMeta(paths.transcriptPath, { permissionMode: mode });
      });

    const setActiveProfile = (
      cwd: string,
      sessionId: string,
      profile: ProfileName,
      parentSessionId?: string
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId, parentSessionId);
        rewriteSessionMeta(paths.transcriptPath, { activeProfile: profile });
      });

    // 会话级切模型：只写会话首行，不碰 config.yaml
    const setModel = (
      cwd: string,
      sessionId: string,
      model: string,
      parentSessionId?: string
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId, parentSessionId);
        rewriteSessionMeta(paths.transcriptPath, { model });
      });

    return {
      create,
      load,
      deleteSession: (sessionId: string, cwd: string): Effect.Effect<void, AgentError> =>
        Effect.sync(() => {
          deleteSessionImpl(sessionId, cwd);
        }),
      forkSession,
      renameSession,
      listSessions: listSessionsFromCwd,

      readHistory: readHistoryFromState,
      recordUser,
      recordSystem,
      recordAssistant,
      recordToolResult,
      appendSummary,
      rollbackToTurn,

      readEvents: (transcriptPath: string): Effect.Effect<SessionEvent[], AgentError> =>
        Effect.try({
          try: () => readHistory(transcriptPath),
          catch: (e) =>
            new AgentError('SESSION_IO_ERROR', `Failed to read transcript ${transcriptPath}`, e),
        }),
      appendEvent: (
        transcriptPath: string,
        event: SessionEvent
      ): Effect.Effect<void, AgentError> =>
        Effect.try({
          try: () => appendLine(transcriptPath, event),
          catch: (e) =>
            new AgentError('SESSION_IO_ERROR', `Failed to append event to ${transcriptPath}`, e),
        }),

      readUITurns: (sessionId: string, cwd: string) =>
        Effect.sync(() => readUIHistory(sessionId, cwd)),

      setPermissionMode: setPermissionModeByAddress,
      setActiveProfile,
      setModel,
    };
  })
);

function forkSessionImpl(sourceJsonlPath: string, atTurnId: number): string {
  const events = readHistory(sourceJsonlPath);
  const atIdx = events.findIndex(
    (e) => e.type === 'user' && (e as any).source !== 'system' && (e as any).turnId === atTurnId
  );

  const chain = atIdx >= 0 ? events.slice(0, atIdx + 1) : events;
  const newSessionId = randomUUID();

  const sessionsDir = dirname(sourceJsonlPath);
  const newJsonlPath = join(sessionsDir, `${newSessionId}.jsonl`);

  for (const ev of chain) {
    const cloned: any = { ...ev };

    if (cloned.type === 'session_meta') {
      cloned.sessionId = newSessionId;
    }

    appendLine(newJsonlPath, cloned);
  }

  return newSessionId;
}
