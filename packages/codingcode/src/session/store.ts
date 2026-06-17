import { Effect } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import type { Message } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { normalizePath, encodeProjectPath } from '../core/path.js';
import { createLogger } from '@codingcode/infra/logger';
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
} from './types.js';
import { estimateTokens, estimateMessageTokens } from '../core/util.js';
import {
  projectSessionsDir,
  ensureDirs,
  readHistory,
  appendLine,
  findSessionIndex,
  listSessions,
  setPermissionMode,
  getPermissionMode,
  readCurrentIndex,
  countNonMetaEvents,
  truncateTitle,
  findFirstUserContent,
  resolveSessionDir,
  resolveSessionJsonlPath as _resolveSessionJsonlPath,
} from './file-ops.js';
import { buildMessages, findLastVisibleAssistantUsage } from './messages.js';

const logger = createLogger();

export interface SessionStoreState {
  sessionId: string;
  cwd: string;
  projectPath: string;
  transcriptPath: string;
  indexPath: string;
  messageCount: number;
  sessionMeta: SessionMetaEvent | null;
  model: string;
  title: string;
  currentTurnId: number;
  usage: TokenUsage | undefined;
  promptEstimate: number;
  memorySnapshot: string;
}

function assertResumeWorkspace(cwd: string, sessionId: string): void {
  const index = findSessionIndex(sessionId);
  if (!index) throw AgentError.sessionNotFound(sessionId);
  if (encodeProjectPath(cwd) !== index.projectPath) {
    throw AgentError.sessionWorkspaceMismatch(sessionId, index.cwd);
  }
}

export class SessionService extends Effect.Service<SessionService>()('Session', {
  effect: Effect.gen(function* () {
    const writeQueues = new Map<string, Promise<void>>();

    const enqueueWriteLocal = (sessionId: string, path: string, data: unknown): void => {
      const prev = writeQueues.get(sessionId) ?? Promise.resolve();
      const task = prev
        .then(() => {
          writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
        })
        .catch((err) => {
          logger.error(`write queue error for ${path}:`, err);
        });
      writeQueues.set(sessionId, task);
    };

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
        promptEstimate: state.promptEstimate,
        permissionMode: current?.permissionMode ?? 'default',
        memorySnapshot: state.memorySnapshot,
      };
      enqueueWriteLocal(state.sessionId, state.indexPath, index);
    }

    const create = (
      cwd: string,
      model: string,
      sessionId?: string,
      opts?: { parentSessionId?: string; parentAgentId?: string; agentName?: string }
    ): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          if (sessionId && !opts?.parentSessionId) assertResumeWorkspace(cwd, sessionId);
          const state = initState(cwd, sessionId, opts?.parentSessionId);
          ensureDirs(state.transcriptPath);

          state.model = model;

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
            return state;
          }

          const meta: SessionMetaEvent = {
            type: 'session_meta',
            sessionId: state.sessionId,
            projectPath: state.projectPath,
            cwd: state.cwd,
            createdAt: new Date().toISOString(),
            ...(opts?.parentSessionId && { parentSessionId: opts.parentSessionId }),
            ...(opts?.parentAgentId && { parentAgentId: opts.parentAgentId }),
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
          state.promptEstimate += estimateMessageTokens({ role: 'user', content });
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
            state.promptEstimate = usage.prompt;
          } else {
            state.promptEstimate += estimateMessageTokens({ role: 'assistant', content });
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
          state.promptEstimate += estimateMessageTokens({
            role: 'tool',
            content: output,
            tool_call_id: toolCallId,
            tool_name: toolName,
          });
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
          state.promptEstimate = estimateTokens(buildMessages(state.transcriptPath));
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
        const lastUsage = findLastVisibleAssistantUsage(state.transcriptPath);
        state.usage = lastUsage;
        state.promptEstimate = lastUsage?.prompt ?? 0;
        return event;
      });

    const forkSession = (
      state: SessionStoreState,
      atTurnId: number
    ): Effect.Effect<string, AgentError> =>
      Effect.sync(() => {
        return forkSessionImpl(state.sessionId, state.transcriptPath, atTurnId);
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

    const readMessages = (state: SessionStoreState): Effect.Effect<Message[]> =>
      Effect.sync(() => buildMessages(state.transcriptPath));

    const listSessionsFromCwd = (cwd?: string): Effect.Effect<SessionIndex[]> =>
      Effect.sync(() => listSessions(cwd ? encodeProjectPath(cwd) : undefined));

    const findSessionIndexFromId = (sessionId: string): Effect.Effect<SessionIndex | null> =>
      Effect.sync(() => findSessionIndex(sessionId));

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
      recordUser,
      recordAssistant,
      recordToolResult,
      appendSummary,
      rollbackToTurn,
      forkSession,
      renameSession,
      readHistory: readHistoryFromState,
      readMessages,
      listSessions: listSessionsFromCwd,
      findSessionIndex: findSessionIndexFromId,
      getSessionId,
      getMessageCount,
      setPermissionMode: setPermissionModeFromState,
      getPermissionMode: getPermissionModeFromState,
      incrementTurn,
      resolveSessionJsonlPath: (sessionId: string): string => _resolveSessionJsonlPath(sessionId),
      readHistoryFile: (path: string): SessionEvent[] => readHistory(path),
      findSessionIndexProxy: (sessionId: string): SessionIndex | null =>
        findSessionIndex(sessionId),
      appendLineProxy: (path: string, event: object): void => appendLine(path, event),
    };
  }),
}) {}

function initState(cwd: string, sessionId?: string, parentSessionId?: string): SessionStoreState {
  const id = sessionId ?? randomUUID();
  const normalizedCwd = normalizePath(cwd);
  const projectPath = encodeProjectPath(normalizedCwd);
  const sessionsDir = projectSessionsDir(projectPath);
  const transcriptPath = parentSessionId
    ? join(sessionsDir, parentSessionId, 'subagents', `${id}.jsonl`)
    : join(sessionsDir, `${id}.jsonl`);
  const indexPath = transcriptPath.replace('.jsonl', '.index.json');
  let currentTurnId = 0;
  let usage: TokenUsage | undefined = undefined;
  let promptEstimate = 0;
  let memorySnapshot = '';
  let model = '';
  try {
    if (existsSync(indexPath)) {
      const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
      currentTurnId = idx.currentTurnId ?? 0;
      usage = idx.usage ?? undefined;
      promptEstimate = idx.promptEstimate ?? 0;
      memorySnapshot = idx.memorySnapshot ?? '';
      model = idx.model ?? '';
    }
  } catch {
    /* ignore corrupt index */
  }
  if (!usage && promptEstimate === 0) {
    const lastUsage = findLastVisibleAssistantUsage(transcriptPath);
    if (lastUsage) {
      usage = lastUsage;
      promptEstimate = lastUsage.prompt;
    }
  }
  return {
    sessionId: id,
    cwd: normalizedCwd,
    projectPath,
    transcriptPath,
    indexPath,
    messageCount: 0,
    sessionMeta: null,
    model,
    title: id.slice(0, 8),
    currentTurnId,
    usage,
    promptEstimate,
    memorySnapshot,
  };
}

function forkSessionImpl(
  sourceSessionId: string,
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

    if (cloned.type === 'summary' || cloned.type === 'compact') {
      cloned.uuid = randomUUID();
    }

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
  let promptEstimate = 0;
  let permissionMode = 'default';
  let srcIdx: SessionIndex | undefined;
  if (existsSync(sourceIdxPath)) {
    try {
      srcIdx = JSON.parse(readFileSync(sourceIdxPath, 'utf8')) as SessionIndex;
      title = srcIdx.title;
      usage = srcIdx.usage ?? undefined;
      promptEstimate = srcIdx.promptEstimate ?? 0;
      permissionMode = srcIdx.permissionMode ?? 'default';
    } catch {
      /* corrupt */
    }
  }

  const lastUsage = findLastVisibleAssistantUsage(newJsonlPath);
  if (lastUsage) {
    usage = lastUsage;
    promptEstimate = lastUsage.prompt;
  } else {
    usage = undefined;
    promptEstimate = estimateTokens(buildMessages(newJsonlPath));
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
    promptEstimate,
    permissionMode,
  };
  writeFileSync(newIndexPath, JSON.stringify(newIdx, null, 2), 'utf8');

  return newSessionId;
}
