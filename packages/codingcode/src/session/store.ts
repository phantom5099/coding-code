import { Effect } from 'effect';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync, openSync, readSync, closeSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { Message } from '../core/types.js';
import type { SessionEvent, SessionMetaEvent, UserEvent, AssistantEvent, ToolResultEvent, RoleSwitchEvent, CompactBoundaryEvent, SessionIndex } from './types.js';

const CODINGCODE_DIR = join(homedir(), '.codingcode');
const SESSIONS_DIR = join(CODINGCODE_DIR, 'sessions');

function makeProjectSlug(cwd: string): string {
  const hash = createHash('sha256').update(cwd).digest('hex');
  return hash.slice(0, 16);
}

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

export interface SessionStoreState {
  sessionId: string;
  cwd: string;
  projectSlug: string;
  transcriptPath: string;
  indexPath: string;
  messageCount: number;
  sessionMeta: SessionMetaEvent | null;
  title: string;
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
      create: (cwd: string, model: string, role: string, version: string, sessionId?: string): Effect.Effect<SessionStoreState> =>
        Effect.sync(() => {
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
            model, role, createdAt: new Date().toISOString(), version,
          };
          state.sessionMeta = meta;
          appendLine(state.transcriptPath, meta);
          updateIndex(state);
          return state;
        }),

      recordUser: (state: SessionStoreState, content: string): Effect.Effect<UserEvent> =>
        Effect.sync(() => {
          const event: UserEvent = { type: 'user', uuid: randomUUID(), content, timestamp: new Date().toISOString() };
          if (state.title === state.sessionId.slice(0, 8)) {
            state.title = makeTitle(content);
          }
          appendEvent(state, event);
          return event;
        }),

      recordAssistant: (state: SessionStoreState, content: string, toolCalls: AssistantEvent['toolCalls'], model: string): Effect.Effect<AssistantEvent> =>
        Effect.sync(() => {
          const event: AssistantEvent = { type: 'assistant', uuid: randomUUID(), content, toolCalls, model, timestamp: new Date().toISOString() };
          appendEvent(state, event);
          return event;
        }),

      recordToolResult: (state: SessionStoreState, parentUuid: string, toolName: string, toolCallId: string, output: string): Effect.Effect<ToolResultEvent> =>
        Effect.sync(() => {
          const event: ToolResultEvent = { type: 'tool_result', uuid: randomUUID(), parentUuid, toolName, toolCallId, output, timestamp: new Date().toISOString() };
          appendEvent(state, event);
          return event;
        }),

      recordRoleSwitch: (state: SessionStoreState, fromRole: string, toRole: string): Effect.Effect<RoleSwitchEvent> =>
        Effect.sync(() => {
          const event: RoleSwitchEvent = { type: 'role_switch', uuid: randomUUID(), fromRole, toRole, timestamp: new Date().toISOString() };
          appendEvent(state, event);
          return event;
        }),

      recordCompactBoundary: (state: SessionStoreState, summary: string, replacedRange: [number, number], messageCount: number): Effect.Effect<CompactBoundaryEvent> =>
        Effect.sync(() => {
          const event: CompactBoundaryEvent = { type: 'compact_boundary', uuid: randomUUID(), summary, replacedRange, messageCount, timestamp: new Date().toISOString() };
          appendEvent(state, event);
          return event;
        }),

      readHistory: (state: SessionStoreState): Effect.Effect<SessionEvent[]> =>
        Effect.sync(() => readHistory(state.transcriptPath)),

      readMessages: (state: SessionStoreState): Effect.Effect<Message[]> =>
        Effect.sync(() => readMessages(state.transcriptPath)),

      listSessions: (): Effect.Effect<SessionIndex[]> =>
        Effect.sync(() => listSessions()),

      getSessionId: (state: SessionStoreState): string => state.sessionId,
      getMessageCount: (state: SessionStoreState): number => state.messageCount,
    };
  }),
}) {}

function initState(cwd: string, sessionId?: string): SessionStoreState {
  const id = sessionId ?? randomUUID();
  const projectSlug = makeProjectSlug(cwd);
  const transcriptPath = join(SESSIONS_DIR, projectSlug, `${id}.jsonl`);
  return {
    sessionId: id, cwd, projectSlug, transcriptPath,
    indexPath: transcriptPath.replace('.jsonl', '.index.json'),
    messageCount: 0, sessionMeta: null, title: id.slice(0, 8),
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
          results.push({ sessionId: meta.sessionId, projectSlug: meta.projectSlug, cwd: meta.cwd, model: meta.model, role: meta.role, createdAt: meta.createdAt, updatedAt: meta.createdAt, messageCount: h.filter((e) => e.type !== 'session_meta').length, title: firstUser ? makeTitle(firstUser) : meta.sessionId.slice(0, 8) });
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
  const index: SessionIndex = { sessionId: state.sessionId, projectSlug: state.projectSlug, cwd: state.cwd, model: state.sessionMeta.model, role: state.sessionMeta.role, createdAt: state.sessionMeta.createdAt, updatedAt: new Date().toISOString(), messageCount: state.messageCount, title: state.title };
  try { writeFileSync(state.indexPath, JSON.stringify(index, null, 2), 'utf8'); } catch { /* non-critical */ }
}
