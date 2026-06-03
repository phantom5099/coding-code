import { Effect } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import type { Message } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { normalizePath, encodeProjectPath } from '../core/path.js';
import type { SessionMetaEvent, UserEvent, AssistantEvent, ToolResultEvent, SummaryEvent, HideEvent, UnhideEvent, TitleEvent, SessionIndex, TokenUsage } from './types.js';
import { estimateTokens, estimateTokensForContent, estimateMessageTokens } from '../context/utils/tokens.js';
import { getContextConfig } from '../context/config.js';
import {
  projectSessionsDir,
  ensureDirs,
  readHistory,
  appendLine,
  findSessionIndex,
  listSessions,
  setPermissionMode,
  getPermissionMode,
  enqueueWrite,
  persistToolResult,
  readCurrentIndex,
  countNonMetaEvents,
  makeTitle,
  findFirstUserContent,
} from './io.js';
import { buildMessages, findLastVisibleAssistantUsage } from './messages.js';

export interface SessionStoreState {
  sessionId: string;
  cwd: string;
  projectPath: string;
  transcriptPath: string;
  indexPath: string;
  messageCount: number;
  sessionMeta: SessionMetaEvent | null;
  title: string;
  currentTurnId: number;
  usage: TokenUsage | undefined;
  promptEstimate: number;
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
    return {
      create: (cwd: string, model: string, sessionId?: string, opts?: { parentSessionId?: string; parentAgentId?: string; agentName?: string }): Effect.Effect<SessionStoreState, AgentError> =>
        Effect.try({
          try: () => {
            if (sessionId && !opts?.parentSessionId) assertResumeWorkspace(cwd, sessionId);
            const state = initState(cwd, sessionId, opts?.parentSessionId);
            ensureDirs(state.transcriptPath);

            if (existsSync(state.transcriptPath)) {
              const history = readHistory(state.transcriptPath);
              const meta = history.find((e) => e.type === 'session_meta') as SessionMetaEvent | undefined;
              if (meta) {
                state.sessionMeta = meta;
                state.messageCount = history.filter((e) => e.type !== 'session_meta').length;
              }
              const firstUser = findFirstUserContent(history);
              if (firstUser) state.title = makeTitle(firstUser);
              return state;
            }

            const meta: SessionMetaEvent = {
              type: 'session_meta', sessionId: state.sessionId,
              projectPath: state.projectPath, cwd: state.cwd,
              model, createdAt: new Date().toISOString(),
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
          catch: (e) => e instanceof AgentError ? e : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
        }),

      recordUser: (state: SessionStoreState, content: string): Effect.Effect<UserEvent, AgentError> =>
        Effect.try({
          try: () => {
            const event: UserEvent = { type: 'user', turnId: state.currentTurnId, uuid: randomUUID(), content, timestamp: new Date().toISOString() };
            if (state.title === state.sessionId.slice(0, 8)) {
              state.title = makeTitle(content);
            }
            appendLine(state.transcriptPath, event);
            state.messageCount++;
            updateIndex(state);
            state.promptEstimate += estimateMessageTokens({ role: 'user', content });
            return event;
          },
          catch: (e) => new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
        }),

      recordAssistant: (state: SessionStoreState, content: string, toolCalls: AssistantEvent['toolCalls'], model: string, usage?: TokenUsage): Effect.Effect<AssistantEvent, AgentError> =>
        Effect.try({
          try: () => {
            const event: AssistantEvent = { type: 'assistant', turnId: state.currentTurnId, uuid: randomUUID(), content, toolCalls, model, timestamp: new Date().toISOString(), usage };
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
          catch: (e) => new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
        }),

      recordToolResult: (state: SessionStoreState, parentUuid: string, toolName: string, toolCallId: string, output: string): Effect.Effect<ToolResultEvent, AgentError> =>
        Effect.try({
          try: () => {
            const cfg = getContextConfig();
            const tokenCount = estimateTokensForContent(output);

            let finalOutput = output;
            let finalTokenCount = tokenCount;

            if (tokenCount > cfg.thresholdTokens &&
                toolName !== 'read' && toolName !== 'read_file') {
              const { path } = persistToolResult(state.projectPath, state.sessionId, toolCallId, output);
              const preview = output.slice(0, cfg.persistPreviewChars);
              finalOutput = `${preview}\n\n[…full output persisted at: ${path}. Use Read tool to access if needed.]`;
              finalTokenCount = estimateTokensForContent(finalOutput);
            }

            const event: ToolResultEvent = { type: 'tool_result', turnId: state.currentTurnId, uuid: randomUUID(), parentUuid, toolName, toolCallId, output: finalOutput, timestamp: new Date().toISOString(), tokenCount: finalTokenCount };
            appendLine(state.transcriptPath, event);
            state.messageCount++;
            updateIndex(state);
            state.promptEstimate += estimateMessageTokens({ role: 'tool', content: finalOutput, tool_call_id: toolCallId, tool_name: toolName });
            return event;
          },
          catch: (e) => new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
        }),

      appendSummary: (state: SessionStoreState, replaces: string[], summaryText: string, method: SummaryEvent['method']): Effect.Effect<SummaryEvent, AgentError> =>
        Effect.try({
          try: () => {
            const event: SummaryEvent = { type: 'summary', uuid: randomUUID(), replaces, summaryText, method, timestamp: new Date().toISOString() };
            appendLine(state.transcriptPath, event);
            state.messageCount++;
            updateIndex(state);
            state.usage = undefined;
            state.promptEstimate = estimateTokens(buildMessages(state.transcriptPath));
            return event;
          },
          catch: (e) => new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
        }),

      hideMessage: (state: SessionStoreState, targetUuid: string, reason: string): Effect.Effect<HideEvent> =>
        Effect.sync(() => {
          const event: HideEvent = { type: 'hide', uuid: randomUUID(), kind: 'message', targetUuid, reason, timestamp: new Date().toISOString() };
          appendLine(state.transcriptPath, event);
          state.messageCount++;
          updateIndex(state);
          state.usage = undefined;
          state.promptEstimate = estimateTokens(buildMessages(state.transcriptPath));
          return event;
        }),

      rollbackToTurn: (state: SessionStoreState, throughTurnId: number, reason: string): Effect.Effect<HideEvent> =>
        Effect.sync(() => {
          const event: HideEvent = { type: 'hide', uuid: randomUUID(), kind: 'rollback', throughTurnId, reason, timestamp: new Date().toISOString() };
          appendLine(state.transcriptPath, event);
          state.messageCount++;
          updateIndex(state);
          const lastUsage = findLastVisibleAssistantUsage(state.transcriptPath);
          state.usage = lastUsage;
          state.promptEstimate = lastUsage?.prompt ?? 0;
          return event;
        }),

      undoLastHide: (state: SessionStoreState): Effect.Effect<UnhideEvent | null> =>
        Effect.sync(() => {
          const history = readHistory(state.transcriptPath);
          let lastHideUuid: string | null = null;
          const unhidTargets = new Set<string>();
          for (const ev of history) {
            if (ev.type === 'hide' && ev.kind === 'message') lastHideUuid = ev.uuid;
            if (ev.type === 'unhide') unhidTargets.add(ev.targetHideUuid);
          }
          if (!lastHideUuid || unhidTargets.has(lastHideUuid)) return null;
          const event: UnhideEvent = { type: 'unhide', uuid: randomUUID(), targetHideUuid: lastHideUuid, timestamp: new Date().toISOString() };
          appendLine(state.transcriptPath, event);
          state.messageCount++;
          updateIndex(state);
          state.usage = undefined;
          state.promptEstimate = estimateTokens(buildMessages(state.transcriptPath));
          return event;
        }),

      forkSession: (state: SessionStoreState, atUuid: string): Effect.Effect<string> =>
        Effect.sync(() => {
          return forkSession(state.sessionId, state.transcriptPath, atUuid);
        }),

      renameSession: (state: SessionStoreState, text: string): Effect.Effect<TitleEvent> =>
        Effect.sync(() => {
          const event: TitleEvent = { type: 'title', uuid: randomUUID(), text, timestamp: new Date().toISOString() };
          state.title = text;
          appendLine(state.transcriptPath, event);
          state.messageCount++;
          updateIndex(state);
          return event;
        }),

      readHistory: (state: SessionStoreState): Effect.Effect<import('./types.js').SessionEvent[]> =>
        Effect.sync(() => readHistory(state.transcriptPath)),

      readMessages: (state: SessionStoreState): Effect.Effect<Message[]> =>
        Effect.sync(() => buildMessages(state.transcriptPath)),

      listSessions: (cwd?: string): Effect.Effect<SessionIndex[]> =>
        Effect.sync(() => listSessions(cwd ? encodeProjectPath(cwd) : undefined)),

      findSessionIndex: (sessionId: string): Effect.Effect<SessionIndex | null> =>
        Effect.sync(() => findSessionIndex(sessionId)),

      getSessionId: (state: SessionStoreState): string => state.sessionId,
      getMessageCount: (state: SessionStoreState): number => state.messageCount,

      setPermissionMode: (state: SessionStoreState, mode: string): Effect.Effect<void> =>
        Effect.sync(() => {
          setPermissionMode(state.sessionId, state.indexPath, mode);
        }),

      getPermissionMode: (state: SessionStoreState): Effect.Effect<string> =>
        Effect.sync(() => {
          return getPermissionMode(state.indexPath);
        }),

      incrementTurn: (state: SessionStoreState): number => {
        state.currentTurnId += 1;
        updateIndex(state);
        return state.currentTurnId;
      },
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
  try {
    if (existsSync(indexPath)) {
      const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
      currentTurnId = idx.currentTurnId ?? 0;
      usage = idx.usage ?? undefined;
      promptEstimate = idx.promptEstimate ?? 0;
    }
  } catch { /* ignore corrupt index */ }
  if (!usage && promptEstimate === 0) {
    const lastUsage = findLastVisibleAssistantUsage(transcriptPath);
    if (lastUsage) {
      usage = lastUsage;
      promptEstimate = lastUsage.prompt;
    }
  }
  return {
    sessionId: id, cwd: normalizedCwd, projectPath, transcriptPath,
    indexPath,
    messageCount: 0, sessionMeta: null, title: id.slice(0, 8), currentTurnId,
    usage,
    promptEstimate,
  };
}

function updateIndex(state: SessionStoreState): void {
  if (!state.sessionMeta) return;
  const current = readCurrentIndex(state.indexPath);
  const index: SessionIndex = {
    sessionId: state.sessionId, projectPath: state.projectPath, cwd: state.cwd,
    model: state.sessionMeta.model,
    createdAt: state.sessionMeta.createdAt,
    updatedAt: new Date().toISOString(),
    messageCount: state.messageCount, title: state.title,
    currentTurnId: state.currentTurnId,
    usage: state.usage,
    promptEstimate: state.promptEstimate,
    permissionMode: current?.permissionMode ?? 'default',
  };
  enqueueWrite(state.sessionId, state.indexPath, index);
}

export function forkSession(sourceSessionId: string, sourceJsonlPath: string, atUuid: string): string {
  const events = readHistory(sourceJsonlPath);
  const atIdx = atUuid ? events.findIndex((e) => 'uuid' in e && (e as any).uuid === atUuid) : -1;

  const chain = atIdx >= 0 ? events.slice(0, atIdx + 1) : events;
  const newSessionId = randomUUID();

  const sessionsDir = dirname(sourceJsonlPath);
  const newJsonlPath = join(sessionsDir, `${newSessionId}.jsonl`);
  const newIndexPath = join(sessionsDir, `${newSessionId}.index.json`);

  const uuidMap = new Map<string, string>();
  let turnId = 0;

  for (const ev of chain) {
    const oldUuid = 'uuid' in ev ? (ev as any).uuid as string : undefined;
    const newUuid = randomUUID();
    if (oldUuid) uuidMap.set(oldUuid, newUuid);

    const cloned: any = { ...ev };
    if (oldUuid) cloned.uuid = newUuid;
    if ('parentUuid' in cloned && cloned.parentUuid) {
      cloned.parentUuid = uuidMap.get(cloned.parentUuid) ?? cloned.parentUuid;
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
  if (existsSync(sourceIdxPath)) {
    try {
      const srcIdx = JSON.parse(readFileSync(sourceIdxPath, 'utf8')) as SessionIndex;
      title = srcIdx.title;
      usage = srcIdx.usage ?? undefined;
      promptEstimate = srcIdx.promptEstimate ?? 0;
      permissionMode = srcIdx.permissionMode ?? 'default';
    } catch { /* corrupt */ }
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
    model: meta?.model ?? '',
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
