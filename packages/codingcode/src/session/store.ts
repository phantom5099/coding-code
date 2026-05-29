import { Effect } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync, openSync, readSync, closeSync, truncateSync, statSync, unlinkSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { Message } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { normalizePath, encodeProjectPath } from '../core/path.js';
import type { SessionEvent, SessionMetaEvent, UserEvent, AssistantEvent, ToolResultEvent, SummaryEvent, HideEvent, UnhideEvent, TitleEvent, SessionIndex } from './types.js';
import { estimateTokensForContent } from '../context/utils/tokens.js';

const CODINGCODE_DIR = join(homedir(), '.codingcode');
const PROJECT_BASE = join(CODINGCODE_DIR, 'project');

function projectSessionsDir(encoded: string): string {
  return join(PROJECT_BASE, encoded, 'sessions');
}

export function resolveSessionDir(sessionId: string): string | null {
  if (!existsSync(PROJECT_BASE)) return null;
  for (const encoded of readdirSync(PROJECT_BASE)) {
    const sessionsDir = join(PROJECT_BASE, encoded, 'sessions');
    if (!existsSync(sessionsDir)) continue;
    try { if (!statSync(sessionsDir).isDirectory()) continue; } catch { continue; }
    if (existsSync(join(sessionsDir, `${sessionId}.jsonl`))) return sessionsDir;
    for (const entry of readdirSync(sessionsDir)) {
      const entryPath = join(sessionsDir, entry);
      try { if (!statSync(entryPath).isDirectory()) continue; } catch { continue; }
      const subagentDir = join(entryPath, 'subagents');
      if (existsSync(join(subagentDir, `${sessionId}.jsonl`))) return subagentDir;
    }
  }
  return null;
}

function ensureDirs(transcriptPath: string): void {
  if (!existsSync(CODINGCODE_DIR)) mkdirSync(CODINGCODE_DIR, { recursive: true });
  const dir = dirname(transcriptPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function quickReadMeta(path: string): SessionMetaEvent | null {
  try {
    const fd = openSync(path, 'r');
    const buffer = Buffer.alloc(4096);
    const bytesRead = readSync(fd, buffer, 0, 4096, 0);
    closeSync(fd);
    const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n')[0];
    if (!firstLine) return null;
    return JSON.parse(firstLine) as SessionMetaEvent;
  } catch {
    return null;
  }
}

export function findSessionIndex(sessionId: string): SessionIndex | null {
  const dir = resolveSessionDir(sessionId);
  if (!dir) return null;
  const idxPath = join(dir, `${sessionId}.index.json`);
  if (existsSync(idxPath)) {
    try {
      const index = JSON.parse(readFileSync(idxPath, 'utf8')) as SessionIndex;
      if (index.sessionId === sessionId) return index;
    } catch { /* corrupt */ }
  }
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(jsonlPath)) return null;
  const meta = quickReadMeta(jsonlPath);
  if (meta?.sessionId !== sessionId) return null;
  const h = readHistory(jsonlPath);
  const firstUser = findFirstUserContent(h);
  return {
    sessionId: meta.sessionId,
    projectPath: meta.projectPath,
    cwd: meta.cwd,
    model: meta.model,
    createdAt: meta.createdAt,
    updatedAt: meta.createdAt,
    messageCount: h.filter((e) => e.type !== 'session_meta').length,
    title: firstUser ? makeTitle(firstUser) : meta.sessionId.slice(0, 8),
    currentTurnId: 0,
    tokenCountEstimate: 0,
    permissionMode: 'default',
  };
}

function assertResumeWorkspace(cwd: string, sessionId: string): void {
  const index = findSessionIndex(sessionId);
  if (!index) throw AgentError.sessionNotFound(sessionId);
  if (encodeProjectPath(cwd) !== index.projectPath) {
    throw AgentError.sessionWorkspaceMismatch(sessionId, index.cwd);
  }
}

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
  tokenCountEstimate: number;
}

function makeTitle(content: string): string {
  const cleaned = content.replace(/\n/g, ' ').trim();
  if (cleaned.length <= 30) return cleaned;
  return cleaned.slice(0, 30) + '...';
}

function findFirstUserContent(history: SessionEvent[]): string | null {
  for (const e of history) {
    if (e.type === 'user') return e.content;
  }
  return null;
}

export class SessionService extends Effect.Service<SessionService>()('Session', {
  effect: Effect.gen(function* () {
    return {
      create: (cwd: string, model: string, version: string, sessionId?: string, opts?: { parentSessionId?: string; parentAgentId?: string; agentName?: string }): Effect.Effect<SessionStoreState, AgentError> =>
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
              model, createdAt: new Date().toISOString(), version,
              ...(opts?.parentSessionId && { parentSessionId: opts.parentSessionId }),
              ...(opts?.parentAgentId && { parentAgentId: opts.parentAgentId }),
              ...(opts?.agentName && { agentName: opts.agentName }),
            };
            state.sessionMeta = meta;
            appendLine(state.transcriptPath, meta);
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
            appendEvent(state, event, estimateTokensForContent(content));
            return event;
          },
          catch: (e) => new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
        }),

      recordAssistant: (state: SessionStoreState, content: string, toolCalls: AssistantEvent['toolCalls'], model: string): Effect.Effect<AssistantEvent, AgentError> =>
        Effect.try({
          try: () => {
            const event: AssistantEvent = { type: 'assistant', turnId: state.currentTurnId, uuid: randomUUID(), content, toolCalls, model, timestamp: new Date().toISOString() };
            appendEvent(state, event, estimateTokensForContent(content));
            return event;
          },
          catch: (e) => new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
        }),

      recordToolResult: (state: SessionStoreState, parentUuid: string, toolName: string, toolCallId: string, output: string): Effect.Effect<ToolResultEvent, AgentError> =>
        Effect.try({
          try: () => {
            const tokenCount = estimateTokensForContent(output);
            const event: ToolResultEvent = { type: 'tool_result', turnId: state.currentTurnId, uuid: randomUUID(), parentUuid, toolName, toolCallId, output, timestamp: new Date().toISOString(), tokenCount };
            appendEvent(state, event, tokenCount);
            return event;
          },
          catch: (e) => new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
        }),

      appendSummary: (state: SessionStoreState, replaces: string[], summaryText: string, method: SummaryEvent['method']): Effect.Effect<SummaryEvent, AgentError> =>
        Effect.try({
          try: () => {
            const event: SummaryEvent = { type: 'summary', uuid: randomUUID(), replaces, summaryText, method, timestamp: new Date().toISOString() };
            appendEvent(state, event, estimateTokensForContent(summaryText));
            return event;
          },
          catch: (e) => new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
        }),

      hideMessage: (state: SessionStoreState, targetUuid: string, reason: string): Effect.Effect<HideEvent> =>
        Effect.sync(() => {
          const event: HideEvent = { type: 'hide', uuid: randomUUID(), kind: 'message', targetUuid, reason, timestamp: new Date().toISOString() };
          appendEvent(state, event, 0);
          return event;
        }),

      rollbackToTurn: (state: SessionStoreState, throughTurnId: number, reason: string): Effect.Effect<HideEvent> =>
        Effect.sync(() => {
          const event: HideEvent = { type: 'hide', uuid: randomUUID(), kind: 'rollback', throughTurnId, reason, timestamp: new Date().toISOString() };
          appendEvent(state, event, 0);
          return event;
        }),

      undoLastHide: (state: SessionStoreState): Effect.Effect<UnhideEvent | null> =>
        Effect.sync(() => {
          const history = readHistory(state.transcriptPath);
          let lastHideUuid: string | null = null;
          const unhidTargets = new Set<string>();
          for (const ev of history) {
            // Only undo kind === 'message' hides, not rollback hides
            if (ev.type === 'hide' && ev.kind === 'message') lastHideUuid = ev.uuid;
            if (ev.type === 'unhide') unhidTargets.add(ev.targetHideUuid);
          }
          if (!lastHideUuid || unhidTargets.has(lastHideUuid)) return null;
          const event: UnhideEvent = { type: 'unhide', uuid: randomUUID(), targetHideUuid: lastHideUuid, timestamp: new Date().toISOString() };
          appendEvent(state, event, 0);
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

      readHistory: (state: SessionStoreState): Effect.Effect<SessionEvent[]> =>
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
  let tokenCountEstimate = 0;
  try {
    if (existsSync(indexPath)) {
      const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
      currentTurnId = idx.currentTurnId ?? 0;
      tokenCountEstimate = idx.tokenCountEstimate ?? 0;
    }
  } catch { /* ignore corrupt index */ }
  return {
    sessionId: id, cwd: normalizedCwd, projectPath, transcriptPath,
    indexPath,
    messageCount: 0, sessionMeta: null, title: id.slice(0, 8), currentTurnId,
    tokenCountEstimate,
  };
}

export function readHistory(path: string): SessionEvent[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8');
  return content.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as SessionEvent);
}

function readMessages(path: string): Message[] {
  const history = readHistory(path);
  return buildMessagesFromEvents(history);
}

/**
 * View assembly: read events → apply summary/hide filtering → produce Message[].
 */
export function buildMessages(path: string): Message[] {
  const events = readHistory(path);
  return buildMessagesFromEvents(events);
}

/**
 * Compute hidden UUID set from hide/unhide/summary events.
 * Reused by buildMessagesFromEvents and readUIHistory for consistent filtering.
 */
export function applyVisibilityEvents(events: SessionEvent[]): Set<string> {
  const hidden = new Set<string>();
  const hideEffects = new Map<string, Set<string>>();

  for (const ev of events) {
    switch (ev.type) {
      case 'hide': {
        let effect: Set<string>;
        if (ev.kind === 'message') {
          effect = new Set([ev.targetUuid]);
        } else {
          effect = new Set<string>();
          for (const prior of events) {
            if (prior === ev) break;
            if ('turnId' in prior && prior.turnId > ev.throughTurnId && 'uuid' in prior) {
              effect.add(prior.uuid);
            }
          }
        }
        hideEffects.set(ev.uuid, effect);
        for (const u of effect) hidden.add(u);
        break;
      }
      case 'unhide': {
        const effect = hideEffects.get(ev.targetHideUuid);
        if (effect) {
          for (const u of effect) hidden.delete(u);
        }
        break;
      }
      case 'summary': {
        for (const u of ev.replaces) hidden.add(u);
        break;
      }
    }
  }

  return hidden;
}

export function buildMessagesFromEvents(events: SessionEvent[]): Message[] {
  const hidden = applyVisibilityEvents(events);

  // Collect visible events
  const visible: SessionEvent[] = [];
  for (const ev of events) {
    if (ev.type === 'hide' || ev.type === 'unhide') continue;
    if ('uuid' in ev && hidden.has((ev as any).uuid)) continue;
    visible.push(ev);
  }

  // Convert visible events to Message[]
  const messages: Message[] = [];
  for (const event of visible) {
    switch (event.type) {
      case 'user':
        messages.push({ role: 'user', content: event.content });
        break;
      case 'assistant': {
        const msg: Message = { role: 'assistant', content: event.content };
        if (event.toolCalls && event.toolCalls.length > 0) {
          (msg as any).tool_calls = event.toolCalls.map((tc: any) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
        }
        messages.push(msg);
        break;
      }
      case 'tool_result':
        messages.push({ role: 'tool', content: event.output, tool_call_id: event.toolCallId, tool_name: event.toolName } as any);
        break;
      case 'summary':
        messages.push({ role: 'system', name: 'compacted_history', content: event.summaryText });
        break;
    }
  }

  // Strip trailing assistant messages whose tool_calls lack matching tool_results
  const resolvedIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool') resolvedIds.add((m as any).tool_call_id);
  }
  while (messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') break;
    const tcs = (last as any).tool_calls as Array<{ id: string }> | undefined;
    if (!tcs || tcs.length === 0) break;
    if (tcs.every((tc) => resolvedIds.has(tc.id))) break;
    messages.pop();
  }

  return messages;
}

export function listSessions(projectPath?: string): SessionIndex[] {
  const results: SessionIndex[] = [];
  const encodedDirs = projectPath ? [projectPath] : existsSync(PROJECT_BASE) ? readdirSync(PROJECT_BASE) : [];
  for (const encoded of encodedDirs) {
    const sessionsDir = join(PROJECT_BASE, encoded, 'sessions');
    if (!existsSync(sessionsDir)) continue;
    for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'))) {
      const jsonlPath = join(sessionsDir, file);
      const idxPath = jsonlPath.replace('.jsonl', '.index.json');
      let index: SessionIndex | null = null;
      if (existsSync(idxPath)) {
        try { index = JSON.parse(readFileSync(idxPath, 'utf8')) as SessionIndex; } catch { /* corrupt */ }
      }
      if (index) {
        results.push(index);
      } else {
        const meta = quickReadMeta(jsonlPath);
        if (meta?.cwd && meta?.sessionId) {
          const h = readHistory(jsonlPath);
          const firstUser = findFirstUserContent(h);
          results.push({ sessionId: meta.sessionId, projectPath: meta.projectPath, cwd: meta.cwd, model: meta.model, createdAt: meta.createdAt, updatedAt: meta.createdAt, messageCount: h.filter((e) => e.type !== 'session_meta').length, title: firstUser ? makeTitle(firstUser) : meta.sessionId.slice(0, 8), currentTurnId: 0, tokenCountEstimate: 0, permissionMode: 'default' });
        }
      }
    }
  }
  return results;
}

function appendEvent(state: SessionStoreState, event: SessionEvent, tokenDelta: number = 0): void {
  appendLine(state.transcriptPath, event);
  state.messageCount++;
  updateIndex(state, tokenDelta);
}

function appendLine(path: string, event: object): void {
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf8');
}

function updateIndex(state: SessionStoreState, tokenDelta: number = 0): void {
  if (!state.sessionMeta) return;
  state.tokenCountEstimate = Math.max(0, state.tokenCountEstimate + tokenDelta);
  const current = readCurrentIndex(state.indexPath);
  const index: SessionIndex = {
    sessionId: state.sessionId, projectPath: state.projectPath, cwd: state.cwd,
    model: state.sessionMeta.model,
    createdAt: state.sessionMeta.createdAt,
    updatedAt: new Date().toISOString(),
    messageCount: state.messageCount, title: state.title,
    currentTurnId: state.currentTurnId,
    tokenCountEstimate: state.tokenCountEstimate,
    permissionMode: current?.permissionMode ?? 'default',
  };
  enqueueWrite(state.sessionId, state.indexPath, index);
}

function readCurrentIndex(indexPath: string): Partial<SessionIndex> | null {
  try { return JSON.parse(readFileSync(indexPath, 'utf8')); } catch { return null; }
}

// Serialized write queue per session: ensures ordered, non-overlapping writes
const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite(sessionId: string, path: string, data: unknown): void {
  const prev = writeQueues.get(sessionId) ?? Promise.resolve();
  const task = prev
    .then(() => { writeFileSync(path, JSON.stringify(data, null, 2), 'utf8'); })
    .catch((err) => { console.error(`write queue error for ${path}:`, err); });
  writeQueues.set(sessionId, task);
}

export function enqueueTask(sessionId: string, fn: () => void): void {
  const prev = writeQueues.get(sessionId) ?? Promise.resolve();
  const task = prev.then(() => { try { fn(); } catch (err) { console.error(`enqueueTask error for ${sessionId}:`, err); } });
  writeQueues.set(sessionId, task);
}

export function truncateJsonl(path: string, byteOffset: number): void {
  try {
    truncateSync(path, byteOffset);
  } catch (err) {
    console.error(`truncateJsonl error for ${path}:`, err);
  }
}

export function deleteSession(sessionId: string): void {
  const dir = resolveSessionDir(sessionId);
  if (!dir) return;
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const idxPath = join(dir, `${sessionId}.index.json`);
  const subagentDir = join(dir, sessionId);
  try { if (existsSync(jsonlPath)) unlinkSync(jsonlPath); } catch {}
  try { if (existsSync(idxPath)) unlinkSync(idxPath); } catch {}
  try { if (existsSync(subagentDir)) rmSync(subagentDir, { recursive: true, force: true }); } catch {}
}

export function forkSession(sourceSessionId: string, sourceJsonlPath: string, atUuid: string): string {
  const events = readHistory(sourceJsonlPath);
  const atIdx = events.findIndex((e) => 'uuid' in e && (e as any).uuid === atUuid);
  if (atIdx === -1) throw new Error(`Event ${atUuid} not found in session ${sourceSessionId}`);

  const chain = events.slice(0, atIdx + 1);
  const newSessionId = randomUUID();

  // Find the sessions directory from the source path
  const sessionsDir = dirname(sourceJsonlPath);
  const newJsonlPath = join(sessionsDir, `${newSessionId}.jsonl`);
  const newIndexPath = join(sessionsDir, `${newSessionId}.index.json`);

  // Remap uuids: generate new uuid for each event, remap parentUuid
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

  // Copy index from source if it exists
  const sourceIdxPath = sourceJsonlPath.replace('.jsonl', '.index.json');
  let title = newSessionId.slice(0, 8);
  let tokenCountEstimate = 0;
  let permissionMode = 'default';
  if (existsSync(sourceIdxPath)) {
    try {
      const srcIdx = JSON.parse(readFileSync(sourceIdxPath, 'utf8')) as SessionIndex;
      title = srcIdx.title;
      tokenCountEstimate = srcIdx.tokenCountEstimate;
      permissionMode = srcIdx.permissionMode ?? 'default';
    } catch { /* corrupt */ }
  }

  const meta = chain[0] as SessionMetaEvent | undefined;
  const newIdx: SessionIndex = {
    sessionId: newSessionId,
    projectPath: meta?.projectPath ?? '',
    cwd: meta?.cwd ?? '',
    model: meta?.model ?? '',
    createdAt: meta?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: chain.filter((e) => e.type !== 'session_meta').length,
    title,
    currentTurnId: turnId,
    tokenCountEstimate,
    permissionMode,
  };
  writeFileSync(newIndexPath, JSON.stringify(newIdx, null, 2), 'utf8');

  return newSessionId;
}

export function setPermissionMode(sessionId: string, indexPath: string, mode: string): void {
  let index: SessionIndex | null = null;
  if (existsSync(indexPath)) {
    try { index = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex; } catch { /* corrupt */ }
  }
  if (!index) {
    const dir = resolveSessionDir(sessionId);
    if (!dir) throw new Error(`Session ${sessionId} not found`);
    index = findSessionIndex(sessionId);
    if (!index) throw new Error(`Session ${sessionId} not found`);
  }
  index.permissionMode = mode;
  index.updatedAt = new Date().toISOString();
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

export function getPermissionMode(indexPath: string): string {
  if (!existsSync(indexPath)) return 'default';
  try {
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
    return index.permissionMode ?? 'default';
  } catch {
    return 'default';
  }
}

function sessionEventsToTurns(events: SessionEvent[]): Array<{ id: string; items: object[]; status: string }> {
  const turnsMap = new Map<number, { id: string; items: object[]; status: string }>();
  for (const event of events) {
    if (event.type === 'session_meta') continue;
    if (event.type === 'summary' || event.type === 'hide' || event.type === 'unhide' || event.type === 'title') continue;
    let turn = turnsMap.get(event.turnId);
    if (!turn) {
      turn = { id: String(event.turnId), items: [], status: 'completed' };
      turnsMap.set(event.turnId, turn);
    }
    switch (event.type) {
      case 'user':
        turn.items.push({ id: event.uuid, type: 'message', role: 'user', content: event.content });
        break;
      case 'assistant':
        if (event.content) {
          turn.items.push({ id: event.uuid, type: 'message', role: 'assistant', content: event.content });
        }
        for (const tc of event.toolCalls ?? []) {
          let args: object;
          try { args = JSON.parse(tc.arguments); } catch { args = {}; }
          turn.items.push({ id: tc.id, type: 'tool_call', name: tc.name, args, status: 'approved' });
        }
        break;
      case 'tool_result':
        turn.items.push({ id: event.uuid, type: 'tool_result', callId: event.toolCallId, name: event.toolName, output: event.output });
        break;
    }
  }
  return [...turnsMap.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

export function readUIHistory(sessionId: string): Array<{ id: string; items: object[]; status: string }> {
  const dir = resolveSessionDir(sessionId);
  if (!dir) return [];
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const events = readHistory(jsonlPath);
  const hidden = applyVisibilityEvents(events);
  const visibleEvents = events.filter((ev) => {
    if (ev.type === 'hide' || ev.type === 'unhide') return false;
    if ('uuid' in ev && hidden.has((ev as any).uuid)) return false;
    return true;
  });
  return sessionEventsToTurns(visibleEvents);
}
