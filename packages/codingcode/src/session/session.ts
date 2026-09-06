import { Effect, Layer } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { AgentError } from '../core/error.js';
import { encodeProjectPath } from '../core/path.js';
import type { PermissionMode } from '../approval/types.js';
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
  ActiveProfileName,
} from './types.js';
import { SessionService } from './port.js';
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
import { readUIHistory, findUserMessageForTurn } from './ui-history.js';
import { computePaths, sessionJsonlPathFromCwd } from '../core/path.js';

function pathsFromState(state: SessionStoreState) {
  return computePaths(state.cwd, state.sessionId, state.parentSessionId);
}

function assertResumeWorkspace(cwd: string, sessionId: string): void {
  const expectedPath = sessionJsonlPathFromCwd(cwd, sessionId);
  if (!existsSync(expectedPath)) throw AgentError.sessionNotFound(sessionId);
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
        activeProfile: ActiveProfileName;
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
          const event: UserEvent = {
            type: 'user',
            turnId: state.currentTurnId,
            content,
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

    const getSessionId = (state: SessionStoreState): string => state.sessionId;

    const getTranscriptPath = (state: SessionStoreState): string =>
      pathsFromState(state).transcriptPath;

    const getMessageCount = (state: SessionStoreState): number => state.messageCount;

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
      profile: ActiveProfileName
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId);
        writeIndexAtomic(paths.indexPath, { activeProfile: profile });
      });

    const getActiveProfile = (
      cwd: string,
      sessionId: string
    ): Effect.Effect<ActiveProfileName | undefined, AgentError> =>
      Effect.sync(() => readActiveProfileSync(cwd, sessionId) ?? undefined);

    const incrementTurn = (state: SessionStoreState): number => {
      state.currentTurnId += 1;
      updateIndex(state);
      return state.currentTurnId;
    };

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
      recordAssistant,
      recordToolResult,
      appendSummary,
      rollbackToTurn,
      incrementTurn,

      readEvents: (transcriptPath: string): SessionEvent[] => readHistory(transcriptPath),
      appendEvent: (transcriptPath: string, event: SessionEvent): void =>
        appendLine(transcriptPath, event),

      readUITurns: (sessionId: string, cwd: string) =>
        Effect.sync(() => readUIHistory(sessionId, cwd)),
      findUserMessageForTurn: (sessionId: string, turnId: number, cwd: string) =>
        Effect.sync(() => findUserMessageForTurn(sessionId, turnId, cwd)),

      setPermissionMode: setPermissionModeByAddress,
      getPermissionMode: getPermissionModeByAddress,
      setActiveProfile,
      getActiveProfile,

      getSessionId,
      getTranscriptPath,
      getMessageCount,
    };
  })
);

function forkSessionImpl(sourceJsonlPath: string, atTurnId: number): string {
  const events = readHistory(sourceJsonlPath);
  const atIdx = events.findIndex((e) => e.type === 'user' && (e as any).turnId === atTurnId);

  const chain = atIdx >= 0 ? events.slice(0, atIdx + 1) : events;
  const newSessionId = randomUUID();

  const sessionsDir = dirname(sourceJsonlPath);
  const newJsonlPath = join(sessionsDir, `${newSessionId}.jsonl`);
  const newIndexPath = join(sessionsDir, `${newSessionId}.index.json`);

  const toolCallIdMap = new Map<string, string>();
  let turnId = 0;

  for (const ev of chain) {
    const cloned: any = { ...ev };

    if (cloned.type === 'assistant' && Array.isArray(cloned.toolCalls)) {
      for (const tc of cloned.toolCalls) {
        const newId = randomUUID();
        toolCallIdMap.set(tc.id, newId);
        tc.id = newId;
      }
    }

    if (cloned.type === 'tool_result' && cloned.toolCallId) {
      cloned.toolCallId = toolCallIdMap.get(cloned.toolCallId) ?? cloned.toolCallId;
    }

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
