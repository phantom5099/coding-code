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
  unlinkSync,
  rmSync,
} from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { getProjectBaseDir } from '../core/path.js';
import { computePaths, projectSessionsDir, sessionJsonlPathFromCwd } from '../core/path.js';
import type { SessionEvent, SessionMetaEvent, SessionIndex, SessionStoreState } from './types.js';

export { computePaths, projectSessionsDir, sessionJsonlPathFromCwd };

export function ensureDirs(transcriptPath: string): void {
  const codingcodeDir = join(homedir(), '.codingcode');
  if (!existsSync(codingcodeDir)) mkdirSync(codingcodeDir, { recursive: true });
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

export function truncateTitle(content: string): string {
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
    model: 'unknown',
    createdAt: meta.createdAt,
    updatedAt: meta.createdAt,
    messageCount: countNonMetaEvents(history),
    title: firstUser ? truncateTitle(firstUser) : meta.sessionId.slice(0, 8),
    currentTurnId: 0,
    usage: undefined,
    mode: 'build',
    permissionMode: 'default',
  };
}

export function listSessions(projectPath?: string): SessionIndex[] {
  const results: SessionIndex[] = [];
  const projectBase = getProjectBaseDir();
  const encodedDirs = projectPath
    ? [projectPath]
    : existsSync(projectBase)
      ? readdirSync(projectBase)
      : [];
  for (const encoded of encodedDirs) {
    const sessionsDir = join(projectBase, encoded, 'sessions');
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

export function writeIndexAtomic(indexPath: string, patch: Partial<SessionIndex>): void {
  let current: Partial<SessionIndex> = {};
  if (existsSync(indexPath)) {
    try {
      current = JSON.parse(readFileSync(indexPath, 'utf8'));
    } catch {
      /* corrupt */
    }
  }
  const merged = { ...current, ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(indexPath, JSON.stringify(merged, null, 2), 'utf8');
}

export function setPermissionMode(
  sessionId: string,
  indexPath: string,
  mode: import('../approval/types.js').PermissionMode
): void {
  let index: SessionIndex | null = null;
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
    } catch {
      /* corrupt */
    }
  }
  if (!index) throw new Error(`Session index not found: ${indexPath}`);
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

export function deleteSession(sessionId: string, cwd: string): void {
  const dir = dirname(sessionJsonlPathFromCwd(cwd, sessionId));
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
