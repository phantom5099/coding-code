import { randomUUID } from 'crypto';
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
  truncateSync,
  statSync,
  unlinkSync,
  rmSync,
} from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { createLogger } from '@codingcode/infra';
import { AgentError } from '../core/error.js';
import { normalizePath, encodeProjectPath } from '../core/path.js';
import type { SessionEvent, SessionMetaEvent, SessionIndex, TokenUsage } from './types.js';

const logger = createLogger();

const CODINGCODE_DIR = join(homedir(), '.codingcode');
const PROJECT_BASE = join(CODINGCODE_DIR, 'project');

export function projectSessionsDir(encoded: string): string {
  return join(PROJECT_BASE, encoded, 'sessions');
}

export function resolveSessionDir(sessionId: string): string | null {
  if (!existsSync(PROJECT_BASE)) return null;
  for (const encoded of readdirSync(PROJECT_BASE)) {
    const sessionsDir = join(PROJECT_BASE, encoded, 'sessions');
    if (!existsSync(sessionsDir)) continue;
    try {
      if (!statSync(sessionsDir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (existsSync(join(sessionsDir, `${sessionId}.jsonl`))) return sessionsDir;
    try {
      for (const entry of readdirSync(sessionsDir)) {
        const entryPath = join(sessionsDir, entry);
        try {
          if (!statSync(entryPath).isDirectory()) continue;
        } catch {
          continue;
        }
        const subagentDir = join(entryPath, 'subagents');
        if (existsSync(join(subagentDir, `${sessionId}.jsonl`))) return subagentDir;
      }
    } catch {
      /* race: directory removed between existsSync and readdirSync */
    }
  }
  return null;
}

export function ensureDirs(transcriptPath: string): void {
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

export function findFirstUserContent(history: SessionEvent[]): string | null {
  for (const e of history) {
    if (e.type === 'user') return e.content;
  }
  return null;
}

export function makeTitle(content: string): string {
  const cleaned = content.replace(/\n/g, ' ').trim();
  if (cleaned.length <= 30) return cleaned;
  return cleaned.slice(0, 30) + '...';
}

export function countNonMetaEvents(history: SessionEvent[]): number {
  return history.filter((e) => e.type !== 'session_meta').length;
}

function buildIndexFromMeta(meta: SessionMetaEvent, history: SessionEvent[]): SessionIndex {
  const firstUser = findFirstUserContent(history);
  return {
    sessionId: meta.sessionId,
    projectPath: meta.projectPath,
    cwd: meta.cwd,
    model: meta.model,
    createdAt: meta.createdAt,
    updatedAt: meta.createdAt,
    messageCount: countNonMetaEvents(history),
    title: firstUser ? makeTitle(firstUser) : meta.sessionId.slice(0, 8),
    currentTurnId: 0,
    usage: undefined,
    promptEstimate: 0,
    permissionMode: 'default',
  };
}

export function findSessionIndex(sessionId: string): SessionIndex | null {
  const dir = resolveSessionDir(sessionId);
  if (!dir) return null;
  const idxPath = join(dir, `${sessionId}.index.json`);
  if (existsSync(idxPath)) {
    try {
      const index = JSON.parse(readFileSync(idxPath, 'utf8')) as SessionIndex;
      if (index.sessionId === sessionId) return index;
    } catch {
      /* corrupt */
    }
  }
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(jsonlPath)) return null;
  const meta = quickReadMeta(jsonlPath);
  if (meta?.sessionId !== sessionId) return null;
  const h = readHistory(jsonlPath);
  return buildIndexFromMeta(meta, h);
}

export function listSessions(projectPath?: string): SessionIndex[] {
  const results: SessionIndex[] = [];
  const encodedDirs = projectPath
    ? [projectPath]
    : existsSync(PROJECT_BASE)
      ? readdirSync(PROJECT_BASE)
      : [];
  for (const encoded of encodedDirs) {
    const sessionsDir = join(PROJECT_BASE, encoded, 'sessions');
    if (!existsSync(sessionsDir)) continue;
    for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'))) {
      const jsonlPath = join(sessionsDir, file);
      const idxPath = jsonlPath.replace('.jsonl', '.index.json');
      let index: SessionIndex | null = null;
      if (existsSync(idxPath)) {
        try {
          index = JSON.parse(readFileSync(idxPath, 'utf8')) as SessionIndex;
        } catch {
          /* corrupt */
        }
      }
      if (index) {
        results.push(index);
      } else {
        const meta = quickReadMeta(jsonlPath);
        if (meta?.cwd && meta?.sessionId) {
          const h = readHistory(jsonlPath);
          results.push(buildIndexFromMeta(meta, h));
        }
      }
    }
  }
  return results;
}

export function readHistory(path: string): SessionEvent[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8');
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SessionEvent);
}

export function appendLine(path: string, event: object): void {
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf8');
}

export function readCurrentIndex(indexPath: string): Partial<SessionIndex> | null {
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    return null;
  }
}

export function setPermissionMode(sessionId: string, indexPath: string, mode: string): void {
  let index: SessionIndex | null = null;
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
    } catch {
      /* corrupt */
    }
  }
  if (!index) {
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

export function deleteSession(sessionId: string): void {
  const dir = resolveSessionDir(sessionId);
  if (!dir) return;
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const idxPath = join(dir, `${sessionId}.index.json`);
  const subagentDir = join(dir, sessionId);
  try {
    if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
  } catch {}
  try {
    if (existsSync(idxPath)) unlinkSync(idxPath);
  } catch {}
  try {
    if (existsSync(subagentDir)) rmSync(subagentDir, { recursive: true, force: true });
  } catch {}
}

// Serialized write queue per session: ensures ordered, non-overlapping writes
const writeQueues = new Map<string, Promise<void>>();

export function enqueueWrite(sessionId: string, path: string, data: unknown): void {
  const prev = writeQueues.get(sessionId) ?? Promise.resolve();
  const task = prev
    .then(() => {
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    })
    .catch((err) => {
      logger.error(`write queue error for ${path}:`, err);
    });
  writeQueues.set(sessionId, task);
}

export function persistToolResult(
  encodedProjectPath: string,
  sessionId: string,
  toolCallId: string,
  content: string
): { path: string; bytes: number } {
  const dir = join(PROJECT_BASE, encodedProjectPath, 'tool-results', sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${toolCallId}.txt`);
  if (!existsSync(file)) {
    writeFileSync(file, content, 'utf8');
  }
  return { path: file.replace(/\\/g, '/'), bytes: Buffer.byteLength(content, 'utf8') };
}
