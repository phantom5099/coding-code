import { Effect } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync, openSync, readSync, closeSync, truncateSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { Message } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { normalizePath, projectSlugFromPath } from '../core/path.js';
import type { SessionEvent, SessionMetaEvent, UserEvent, AssistantEvent, ToolResultEvent, SessionIndex } from './types.js';
import { estimateTokensForContent } from '../context/utils/tokens.js';

const CODINGCODE_DIR = join(homedir(), '.codingcode');
const SESSIONS_DIR = join(CODINGCODE_DIR, 'sessions');

function ensureDirs(transcriptPath: string): void {
  if (!existsSync(CODINGCODE_DIR)) mkdirSync(CODINGCODE_DIR, { recursive: true });
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
  const projectDir = dirname(transcriptPath);
  if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });
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
  if (!existsSync(SESSIONS_DIR)) return null;
  for (const slug of readdirSync(SESSIONS_DIR)) {
    const dir = join(SESSIONS_DIR, slug);
    const idxPath = join(dir, `${sessionId}.index.json`);
    if (existsSync(idxPath)) {
      try {
        const index = JSON.parse(readFileSync(idxPath, 'utf8')) as SessionIndex;
        if (index.sessionId === sessionId) return index;
      } catch { /* corrupt */ }
    }
    const jsonlPath = join(dir, `${sessionId}.jsonl`);
    if (!existsSync(jsonlPath)) continue;
    const meta = quickReadMeta(jsonlPath);
    if (meta?.sessionId !== sessionId) continue;
    const h = readHistory(jsonlPath);
    const firstUser = findFirstUserContent(h);
    return {
      sessionId: meta.sessionId,
      projectSlug: meta.projectSlug,
      cwd: meta.cwd,
      model: meta.model,
      createdAt: meta.createdAt,
      updatedAt: meta.createdAt,
      messageCount: h.filter((e) => e.type !== 'session_meta').length,
      title: firstUser ? makeTitle(firstUser) : meta.sessionId.slice(0, 8),
      currentTurnId: 0,
      tokenCountEstimate: 0,
      projectedRanges: [],
      lastUncoveredByteOffset: 0,
      projectionCount: 0,
      lastCompressionFailures: 0,
    };
  }
  return null;
}

function assertResumeWorkspace(cwd: string, sessionId: string): void {
  const index = findSessionIndex(sessionId);
  if (!index) throw AgentError.sessionNotFound(sessionId);
  if (projectSlugFromPath(cwd) !== index.projectSlug) {
    throw AgentError.sessionWorkspaceMismatch(sessionId, index.cwd);
  }
}

export interface SessionStoreState {
  sessionId: string;
  cwd: string;
  projectSlug: string;
  transcriptPath: string;
  indexPath: string;
  messageCount: number;
  sessionMeta: SessionMetaEvent | null;
  title: string;
  currentTurnId: number;
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
      create: (cwd: string, model: string, version: string, sessionId?: string): Effect.Effect<SessionStoreState> =>
        Effect.sync(() => {
          if (sessionId) assertResumeWorkspace(cwd, sessionId);
          const state = initState(cwd, sessionId);
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
            projectSlug: state.projectSlug, cwd: state.cwd,
            model, createdAt: new Date().toISOString(), version,
          };
          state.sessionMeta = meta;
          appendLine(state.transcriptPath, meta);
          updateIndex(state);
          return state;
        }),

      recordUser: (state: SessionStoreState, content: string): Effect.Effect<UserEvent> =>
        Effect.sync(() => {
          const event: UserEvent = { type: 'user', turnId: state.currentTurnId, uuid: randomUUID(), content, timestamp: new Date().toISOString() };
          if (state.title === state.sessionId.slice(0, 8)) {
            state.title = makeTitle(content);
          }
          appendEvent(state, event);
          return event;
        }),

      recordAssistant: (state: SessionStoreState, content: string, toolCalls: AssistantEvent['toolCalls'], model: string): Effect.Effect<AssistantEvent> =>
        Effect.sync(() => {
          const event: AssistantEvent = { type: 'assistant', turnId: state.currentTurnId, uuid: randomUUID(), content, toolCalls, model, timestamp: new Date().toISOString() };
          appendEvent(state, event);
          return event;
        }),

      recordToolResult: (state: SessionStoreState, parentUuid: string, toolName: string, toolCallId: string, output: string): Effect.Effect<ToolResultEvent> =>
        Effect.sync(() => {
          const tokenCount = estimateTokensForContent(output);
          const event: ToolResultEvent = { type: 'tool_result', turnId: state.currentTurnId, uuid: randomUUID(), parentUuid, toolName, toolCallId, output, timestamp: new Date().toISOString(), tokenCount };
          appendEvent(state, event);
          return event;
        }),

      readHistory: (state: SessionStoreState): Effect.Effect<SessionEvent[]> =>
        Effect.sync(() => readHistory(state.transcriptPath)),

      readMessages: (state: SessionStoreState): Effect.Effect<Message[]> =>
        Effect.sync(() => readMessages(state.transcriptPath)),

      listSessions: (cwd?: string): Effect.Effect<SessionIndex[]> =>
        Effect.sync(() => listSessions(cwd ? projectSlugFromPath(cwd) : undefined)),

      findSessionIndex: (sessionId: string): Effect.Effect<SessionIndex | null> =>
        Effect.sync(() => findSessionIndex(sessionId)),

      getSessionId: (state: SessionStoreState): string => state.sessionId,
      getMessageCount: (state: SessionStoreState): number => state.messageCount,

      incrementTurn: (state: SessionStoreState): number => {
        state.currentTurnId += 1;
        updateIndex(state);
        return state.currentTurnId;
      },
    };
  }),
}) {}

function initState(cwd: string, sessionId?: string): SessionStoreState {
  const id = sessionId ?? randomUUID();
  const normalizedCwd = normalizePath(cwd);
  const projectSlug = projectSlugFromPath(normalizedCwd);
  const transcriptPath = join(SESSIONS_DIR, projectSlug, `${id}.jsonl`);
  const indexPath = transcriptPath.replace('.jsonl', '.index.json');
  let currentTurnId = 0;
  try {
    if (existsSync(indexPath)) {
      const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
      currentTurnId = idx.currentTurnId ?? 0;
    }
  } catch { /* ignore corrupt index */ }
  return {
    sessionId: id, cwd: normalizedCwd, projectSlug, transcriptPath,
    indexPath,
    messageCount: 0, sessionMeta: null, title: id.slice(0, 8), currentTurnId,
  };
}

function readHistory(path: string): SessionEvent[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8');
  return content.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as SessionEvent);
}

function readMessages(path: string): Message[] {
  const history = readHistory(path);
  const messages: Message[] = [];
  for (const event of history) {
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
    }
  }

  // Strip trailing assistant messages whose tool_calls lack matching tool_results
  // (session interrupted mid-execution). The LLM API rejects these.
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

function listSessions(projectSlug?: string): SessionIndex[] {
  const results: SessionIndex[] = [];
  const projects = projectSlug ? [projectSlug] : existsSync(SESSIONS_DIR) ? readdirSync(SESSIONS_DIR) : [];
  for (const slug of projects) {
    const dir = join(SESSIONS_DIR, slug);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      const id = file.replace('.jsonl', '');
      const jsonlPath = join(dir, file);
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
          results.push({ sessionId: meta.sessionId, projectSlug: meta.projectSlug, cwd: meta.cwd, model: meta.model, createdAt: meta.createdAt, updatedAt: meta.createdAt, messageCount: h.filter((e) => e.type !== 'session_meta').length, title: firstUser ? makeTitle(firstUser) : meta.sessionId.slice(0, 8), currentTurnId: 0, tokenCountEstimate: 0, projectedRanges: [], lastUncoveredByteOffset: 0, projectionCount: 0, lastCompressionFailures: 0 });
        }
      }
    }
  }
  return results;
}

function appendEvent(state: SessionStoreState, event: SessionEvent): void {
  appendLine(state.transcriptPath, event);
  state.messageCount++;
  updateIndex(state);
}

function appendLine(path: string, event: object): void {
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf8');
}

function updateIndex(state: SessionStoreState): void {
  if (!state.sessionMeta) return;
  const current = readCurrentIndex(state.indexPath);
  const index: SessionIndex = {
    sessionId: state.sessionId, projectSlug: state.projectSlug, cwd: state.cwd,
    model: state.sessionMeta.model,
    createdAt: state.sessionMeta.createdAt,
    updatedAt: new Date().toISOString(),
    messageCount: state.messageCount, title: state.title,
    currentTurnId: state.currentTurnId,
    tokenCountEstimate: current?.tokenCountEstimate ?? 0,
    projectedRanges: current?.projectedRanges ?? [],
    lastUncoveredByteOffset: current?.lastUncoveredByteOffset ?? 0,
    lastProjectionAt: current?.lastProjectionAt,
    projectionCount: current?.projectionCount ?? 0,
    lastCompressionFailures: current?.lastCompressionFailures ?? 0,
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
