import { Effect, Layer } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { AgentError } from '../core/error.js';
import { encodeProjectPath } from '../core/path.js';
import type {
  SessionMetaEvent,
  UserEvent,
  AssistantEvent,
  ToolResultEvent,
  SummaryEvent,
  RollbackEvent,
  SessionIndex,
  TokenUsage,
  SessionEvent,
  SessionStoreState,
  ProfileName,
  PermissionMode,
  CompactEvent,
} from './types.js';
import { SessionService } from './port.js';
import type { UITurn } from './port.js';
import {
  ensureDirs,
  readHistory,
  appendLine,
  listSessions,
  setPermissionMode,
  getPermissionMode,
  readCurrentIndex,
  writeIndexAtomic,
  countNonMetaEvents,
  truncateTitle,
  findFirstUserContent,
  readActiveProfileSync,
  deleteSession as deleteSessionImpl,
} from './file-ops.js';
import { computePaths, sessionJsonlPathFromCwd } from '../core/path.js';

function pathsFromState(state: SessionStoreState) {
  return computePaths(state.cwd, state.sessionId, state.parentSessionId);
}

function assertResumeWorkspace(cwd: string, sessionId: string): void {
  const expectedPath = sessionJsonlPathFromCwd(cwd, sessionId);
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
    function updateIndex(state: SessionStoreState): void {
      if (!state.sessionMeta) return;
      const paths = pathsFromState(state);
      const index: SessionIndex = {
        sessionId: state.sessionId,
        cwd: state.cwd,
        model: state.model,
        createdAt: state.sessionMeta.createdAt,
        updatedAt: new Date().toISOString(),
        messageCount: state.messageCount,
        title: state.title,
        currentTurnId: state.currentTurnId,
        usage: state.usage,
        permissionMode: state.permissionMode,
        memorySnapshot: state.memorySnapshot,
        activeProfile: state.activeProfile,
        parentSessionId: state.parentSessionId,
      };
      writeFileSync(paths.indexPath, JSON.stringify(index, null, 2), 'utf8');
    }

    const create = (
      cwd: string,
      options: {
        model: string;
        activeProfile: ProfileName;
        permissionMode: PermissionMode;
      },
      opts?: { parentSessionId?: string; agentName?: string }
    ): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          const paths = computePaths(cwd, randomUUID(), opts?.parentSessionId);
          ensureDirs(paths.transcriptPath);

          const state: SessionStoreState = {
            sessionId: paths.sessionId,
            cwd: paths.cwd,
            messageCount: 0,
            sessionMeta: null,
            model: options.model,
            permissionMode: options.permissionMode,
            title: paths.sessionId.slice(0, 8),
            currentTurnId: 0,
            usage: undefined,
            memorySnapshot: '',
            activeProfile: options.activeProfile,
            parentSessionId: opts?.parentSessionId,
          };

          const meta: SessionMetaEvent = {
            type: 'session_meta',
            sessionId: state.sessionId,
            cwd: state.cwd,
            createdAt: new Date().toISOString(),
            activeProfile: options.activeProfile,
            permissionMode: options.permissionMode,
            ...(opts?.parentSessionId && { parentSessionId: opts.parentSessionId }),
            ...(opts?.agentName && { agentName: opts.agentName }),
          };
          state.sessionMeta = meta;
          appendLine(paths.transcriptPath, meta);
          state.messageCount++;
          updateIndex(state);
          return state;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const load = (cwd: string, sessionId: string): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          assertResumeWorkspace(cwd, sessionId);
          const paths = computePaths(cwd, sessionId);
          ensureDirs(paths.transcriptPath);

          const idx = readCurrentIndex(paths.indexPath);
          if (!idx?.activeProfile) throw new Error('Session index missing activeProfile');

          const state: SessionStoreState = {
            sessionId: paths.sessionId,
            cwd: paths.cwd,
            messageCount: 0,
            sessionMeta: null,
            model: idx?.model ?? '',
            permissionMode: idx?.permissionMode ?? 'default',
            title: paths.sessionId.slice(0, 8),
            currentTurnId: idx?.currentTurnId ?? 0,
            usage: idx?.usage ?? undefined,
            memorySnapshot: idx?.memorySnapshot ?? '',
            activeProfile: idx.activeProfile,
          };

          if (existsSync(paths.transcriptPath)) {
            const history = readHistory(paths.transcriptPath);
            const meta = history.find((e) => e.type === 'session_meta') as
              | SessionMetaEvent
              | undefined;
            if (meta) {
              state.sessionMeta = meta;
              state.messageCount = history.filter((e) => e.type !== 'session_meta').length;
            }
            const firstUser = findFirstUserContent(history);
            if (firstUser) state.title = truncateTitle(firstUser);
          }
          return state;
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
          if (state.title === state.sessionId.slice(0, 8)) {
            state.title = truncateTitle(content);
          }
          appendLine(pathsFromState(state).transcriptPath, event);
          state.messageCount++;
          updateIndex(state);
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
          state.messageCount++;
          updateIndex(state);
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
          state.messageCount++;
          updateIndex(state);
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
          state.messageCount++;
          updateIndex(state);
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
          state.messageCount++;
          state.usage = undefined;
          updateIndex(state);
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
        appendLine(pathsFromState(state).transcriptPath, event);
        state.messageCount++;

        const events = readHistory(pathsFromState(state).transcriptPath);
        const minRollbackThrough = events.reduce(
          (min, ev) => (ev.type === 'rollback' && ev.throughTurnId < min ? ev.throughTurnId : min),
          Infinity
        );
        let lastUsage: TokenUsage | undefined;
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i]!;
          if ('turnId' in ev && minRollbackThrough <= (ev as { turnId: number }).turnId) {
            continue;
          }
          if (ev.type === 'assistant' && (ev as AssistantEvent).usage) {
            lastUsage = (ev as AssistantEvent).usage;
            break;
          }
        }
        state.usage = lastUsage;

        updateIndex(state);
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
        updateIndex(state);
      });

    const readHistoryFromState = (state: SessionStoreState): Effect.Effect<SessionEvent[]> =>
      Effect.sync(() => readHistory(pathsFromState(state).transcriptPath));

    const listSessionsFromCwd = (cwd?: string): Effect.Effect<SessionIndex[]> =>
      Effect.sync(() => listSessions(cwd ? encodeProjectPath(cwd) : undefined));

    const setPermissionModeByAddress = (
      cwd: string,
      sessionId: string,
      mode: PermissionMode
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId);
        setPermissionMode(sessionId, paths.indexPath, mode);
      });

    const getPermissionModeByAddress = (
      cwd: string,
      sessionId: string
    ): Effect.Effect<PermissionMode, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId);
        const raw = getPermissionMode(paths.indexPath);
        if (raw === 'default' || raw === 'acceptEdits' || raw === 'bypass') return raw;
        return 'default';
      });

    const setActiveProfile = (
      cwd: string,
      sessionId: string,
      profile: ProfileName
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId);
        writeIndexAtomic(paths.indexPath, { activeProfile: profile });
      });

    const getActiveProfile = (
      cwd: string,
      sessionId: string
    ): Effect.Effect<ProfileName | undefined, AgentError> =>
      Effect.sync(() => readActiveProfileSync(cwd, sessionId) ?? undefined);

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

      readEvents: (transcriptPath: string): SessionEvent[] => readHistory(transcriptPath),
      appendEvent: (transcriptPath: string, event: SessionEvent): void =>
        appendLine(transcriptPath, event),

      readUITurns: (sessionId: string, cwd: string) =>
        Effect.sync(() => readUIHistory(sessionId, cwd)),

      setPermissionMode: setPermissionModeByAddress,
      getPermissionMode: getPermissionModeByAddress,
      setActiveProfile,
      getActiveProfile,
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
  const newIndexPath = join(sessionsDir, `${newSessionId}.index.json`);

  let turnId = 0;

  for (const ev of chain) {
    const cloned: any = { ...ev };

    if (cloned.type === 'session_meta') {
      cloned.sessionId = newSessionId;
    }
    if ('turnId' in cloned) {
      turnId = Math.max(turnId, cloned.turnId);
    }

    appendLine(newJsonlPath, cloned);
  }

  const sourceIdxPath = sourceJsonlPath.replace('.jsonl', '.index.json');
  let title = newSessionId.slice(0, 8);
  let usage: TokenUsage | undefined = undefined;
  let permissionMode: PermissionMode = 'default';
  let srcIdx: SessionIndex | undefined;
  if (existsSync(sourceIdxPath)) {
    try {
      srcIdx = JSON.parse(readFileSync(sourceIdxPath, 'utf8')) as SessionIndex;
      title = srcIdx.title;
      usage = srcIdx.usage ?? undefined;
      permissionMode = srcIdx.permissionMode ?? 'default';
    } catch {
      /* corrupt */
    }
  }

  const meta = chain[0] as SessionMetaEvent | undefined;
  const activeProfile = srcIdx?.activeProfile ?? meta?.activeProfile;
  if (!activeProfile) throw new Error('Fork source missing activeProfile');
  const newIdx: SessionIndex = {
    sessionId: newSessionId,
    cwd: meta?.cwd ?? '',
    model: srcIdx?.model ?? '',
    createdAt: meta?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: countNonMetaEvents(chain),
    title,
    currentTurnId: turnId,
    usage,
    permissionMode,
    activeProfile,
  };
  writeFileSync(newIndexPath, JSON.stringify(newIdx, null, 2), 'utf8');

  return newSessionId;
}
