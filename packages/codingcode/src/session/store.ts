import { Effect } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { AgentError } from '../core/error.js';
import { normalizePath, encodeProjectPath } from '../core/path.js';
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
} from './types.js';
import {
  projectSessionsDir,
  ensureDirs,
  readHistory,
  appendLine,
  listSessions,
  setPermissionMode,
  getPermissionMode,
  readCurrentIndex,
  countNonMetaEvents,
  truncateTitle,
  findFirstUserContent,
  sessionJsonlPathFromCwd,
} from './file-ops.js';

function assertResumeWorkspace(cwd: string, sessionId: string): void {
  const expectedPath = sessionJsonlPathFromCwd(cwd, sessionId);
  if (!existsSync(expectedPath)) throw AgentError.sessionNotFound(sessionId);
}

export class SessionService extends Effect.Service<SessionService>()('Session', {
  effect: Effect.gen(function* () {
    function updateIndex(state: SessionStoreState): void {
      if (!state.sessionMeta) return;
      const current = readCurrentIndex(state.indexPath);
      const index: SessionIndex = {
        sessionId: state.sessionId,
        projectPath: state.projectPath,
        cwd: state.cwd,
        model: state.model,
        createdAt: state.sessionMeta.createdAt,
        updatedAt: new Date().toISOString(),
        messageCount: state.messageCount,
        title: state.title,
        currentTurnId: state.currentTurnId,
        usage: state.usage,
        permissionMode: current?.permissionMode ?? 'default',
        memorySnapshot: state.memorySnapshot,
      };
      writeFileSync(state.indexPath, JSON.stringify(index, null, 2), 'utf8');
    }

    const create = (
      cwd: string,
      model: string,
      opts?: { parentSessionId?: string; agentName?: string }
    ): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          const paths = computePaths(cwd, randomUUID(), opts?.parentSessionId);
          ensureDirs(paths.transcriptPath);

          const state: SessionStoreState = {
            ...paths,
            messageCount: 0,
            sessionMeta: null,
            model,
            title: paths.sessionId.slice(0, 8),
            currentTurnId: 0,
            usage: undefined,
            memorySnapshot: '',
          };

          const meta: SessionMetaEvent = {
            type: 'session_meta',
            sessionId: state.sessionId,
            projectPath: state.projectPath,
            cwd: state.cwd,
            createdAt: new Date().toISOString(),
            ...(opts?.parentSessionId && { parentSessionId: opts.parentSessionId }),
            ...(opts?.agentName && { agentName: opts.agentName }),
          };
          state.sessionMeta = meta;
          appendLine(state.transcriptPath, meta);
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

          const state: SessionStoreState = {
            ...paths,
            messageCount: 0,
            sessionMeta: null,
            model: idx?.model ?? '',
            title: paths.sessionId.slice(0, 8),
            currentTurnId: idx?.currentTurnId ?? 0,
            usage: idx?.usage ?? undefined,
            memorySnapshot: idx?.memorySnapshot ?? '',
          };

          if (existsSync(state.transcriptPath)) {
            const history = readHistory(state.transcriptPath);
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
          appendLine(state.transcriptPath, event);
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
          appendLine(state.transcriptPath, event);
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
          appendLine(state.transcriptPath, event);
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
          appendLine(state.transcriptPath, event);
          state.messageCount++;
          updateIndex(state);
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
        appendLine(state.transcriptPath, event);
        state.messageCount++;
        updateIndex(state);
        return event;
      });

    const forkSession = (
      state: SessionStoreState,
      atTurnId: number
    ): Effect.Effect<string, AgentError> =>
      Effect.sync(() => {
        return forkSessionImpl(state.transcriptPath, atTurnId);
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
      Effect.sync(() => readHistory(state.transcriptPath));

    const listSessionsFromCwd = (cwd?: string): Effect.Effect<SessionIndex[]> =>
      Effect.sync(() => listSessions(cwd ? encodeProjectPath(cwd) : undefined));

    const getSessionId = (state: SessionStoreState): string => state.sessionId;

    const getMessageCount = (state: SessionStoreState): number => state.messageCount;

    const setPermissionModeFromState = (
      state: SessionStoreState,
      mode: string
    ): Effect.Effect<void> =>
      Effect.sync(() => {
        setPermissionMode(state.sessionId, state.indexPath, mode);
      });

    const getPermissionModeFromState = (state: SessionStoreState): Effect.Effect<string> =>
      Effect.sync(() => getPermissionMode(state.indexPath));

    const incrementTurn = (state: SessionStoreState): number => {
      state.currentTurnId += 1;
      updateIndex(state);
      return state.currentTurnId;
    };

    return {
      create,
      load,
      recordUser,
      recordAssistant,
      recordToolResult,
      appendSummary,
      rollbackToTurn,
      forkSession,
      renameSession,
      readHistory: readHistoryFromState,
      listSessions: listSessionsFromCwd,
      getSessionId,
      getMessageCount,
      setPermissionMode: setPermissionModeFromState,
      getPermissionMode: getPermissionModeFromState,
      incrementTurn,
      readHistoryFile: (path: string): SessionEvent[] => readHistory(path),
      appendLineProxy: (path: string, event: object): void => appendLine(path, event),
    };
  }),
}) {}

function computePaths(
  cwd: string,
  sessionId: string,
  parentSessionId?: string
): Pick<SessionStoreState, 'sessionId' | 'cwd' | 'projectPath' | 'transcriptPath' | 'indexPath'> {
  const normalizedCwd = normalizePath(cwd);
  const projectPath = encodeProjectPath(normalizedCwd);
  const sessionsDir = projectSessionsDir(projectPath);
  const transcriptPath = parentSessionId
    ? join(sessionsDir, parentSessionId, 'subagents', `${sessionId}.jsonl`)
    : join(sessionsDir, `${sessionId}.jsonl`);
  const indexPath = transcriptPath.replace('.jsonl', '.index.json');
  return { sessionId, cwd: normalizedCwd, projectPath, transcriptPath, indexPath };
}

function forkSessionImpl(
  sourceJsonlPath: string,
  atTurnId: number
): string {
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
  let permissionMode = 'default';
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
  const newIdx: SessionIndex = {
    sessionId: newSessionId,
    projectPath: meta?.projectPath ?? '',
    cwd: meta?.cwd ?? '',
    model: srcIdx?.model ?? '',
    createdAt: meta?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: countNonMetaEvents(chain),
    title,
    currentTurnId: turnId,
    usage,
    permissionMode,
  };
  writeFileSync(newIndexPath, JSON.stringify(newIdx, null, 2), 'utf8');

  return newSessionId;
}
