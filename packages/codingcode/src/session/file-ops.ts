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
  statSync,
  renameSync,
} from 'fs';
import { join, dirname } from 'path';
import { getGlobalDir, projectRootDir } from '../util/path.js';
import { transcriptPathOf, SESSIONS_DIRNAME } from './paths.js';
import type { SessionEvent, SessionMetaEvent } from './types.js';
import type { SessionSummary } from './types.js';
import type { TokenUsage } from '../llm/types.js';

/** 首行最大读取字节数：会话头远小于此值。 */
const HEAD_BYTES = 8192;
/** 尾部扫描初始窗口，命中不到时按 4 倍扩大。 */
const TAIL_WINDOW_BYTES = 16 * 1024;

export function sessionJsonlPathFromCwd(
  cwd: string,
  sessionId: string,
  parentSessionId?: string
): string {
  return transcriptPathOf(cwd, sessionId, parentSessionId);
}

export function ensureDirs(transcriptPath: string): void {
  const codingcodeDir = getGlobalDir();
  if (!existsSync(codingcodeDir)) mkdirSync(codingcodeDir, { recursive: true });
  const dir = dirname(transcriptPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function truncateTitle(content: string): string {
  const cleaned = content.replace(/\n/g, ' ').trim();
  if (cleaned.length <= 30) return cleaned;
  return cleaned.slice(0, 30) + '...';
}

/** 读取会话文件首行（会话索引行）。 */
export function readSessionMeta(transcriptPath: string): SessionMetaEvent | null {
  try {
    const fd = openSync(transcriptPath, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    let bytesRead = 0;
    try {
      bytesRead = readSync(fd, buffer, 0, HEAD_BYTES, 0);
    } finally {
      closeSync(fd);
    }
    const newlineAt = buffer.subarray(0, bytesRead).indexOf(0x0a);
    const end = newlineAt === -1 ? bytesRead : newlineAt;
    const line = buffer.toString('utf8', 0, end);
    if (!line.trim()) return null;
    const parsed = JSON.parse(line) as SessionEvent;
    return parsed.type === 'session_meta' ? parsed : null;
  } catch {
    return null;
  }
}

/** 原子重写首行（身份字段变更：标题 / 模型 / 权限模式 / profile）。 */
export function rewriteSessionMeta(transcriptPath: string, patch: Partial<SessionMetaEvent>): void {
  const raw = readFileSync(transcriptPath, 'utf8');
  const newlineAt = raw.indexOf('\n');
  if (newlineAt < 0) return;
  const meta = JSON.parse(raw.slice(0, newlineAt)) as SessionEvent;
  if (meta.type !== 'session_meta') return;
  const next = JSON.stringify({ ...meta, ...patch });
  const tmpPath = `${transcriptPath}.tmp`;
  writeFileSync(tmpPath, next + raw.slice(newlineAt), 'utf8');
  renameSync(tmpPath, transcriptPath);
}

function readWindow(transcriptPath: string, start: number, end: number): SessionEvent[] {
  const fd = openSync(transcriptPath, 'r');
  const buffer = Buffer.alloc(end - start);
  try {
    readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    closeSync(fd);
  }
  const rawLines = buffer.toString('utf8').split('\n');
  const lines = (start > 0 ? rawLines.slice(1) : rawLines).filter((l) => l.trim());
  const events: SessionEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as SessionEvent);
    } catch {
      /* 截断行 */
    }
  }
  return events;
}

/** 从尾部按窗口 4 倍扩大读取，直到 visit 判定可返回或已覆盖整个文件。 */
function scanTail<T>(
  transcriptPath: string,
  visit: (events: SessionEvent[]) => T | undefined
): T | undefined {
  const size = statSync(transcriptPath).size;
  let window = TAIL_WINDOW_BYTES;
  for (;;) {
    const start = Math.max(0, size - window);
    const decided = visit(readWindow(transcriptPath, start, size));
    if (decided !== undefined || start === 0) return decided;
    window *= 4;
  }
}

/** 尾部的最大 turnId；文件里没有带 turnId 的事件时返回 0。 */
export function readLastTurnId(transcriptPath: string): number {
  return (
    scanTail(transcriptPath, (events) => {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]!;
        if ('turnId' in ev && typeof ev.turnId === 'number') return ev.turnId;
      }
      return undefined;
    }) ?? 0
  );
}

/** 尾部最后一个可见助手用量；回滚事件隐藏的 turn 会被跳过。 */
export function readLastUsage(transcriptPath: string): TokenUsage | undefined {
  return scanTail(transcriptPath, (events) => {
    let minRollbackThrough = Infinity;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]!;
      if (ev.type === 'rollback') {
        if (ev.throughTurnId < minRollbackThrough) minRollbackThrough = ev.throughTurnId;
        continue;
      }
      if (ev.type === 'assistant' && ev.usage) {
        if (minRollbackThrough <= ev.turnId) continue;
        return ev.usage;
      }
    }
    return undefined;
  });
}

export function listSessions(encodedProjectPath?: string): SessionSummary[] {
  const results: SessionSummary[] = [];
  const projectBase = projectRootDir();
  const encodedDirs = encodedProjectPath
    ? [encodedProjectPath]
    : existsSync(projectBase)
      ? readdirSync(projectBase)
      : [];
  for (const encoded of encodedDirs) {
    const sessionsDir = join(projectBase, encoded, SESSIONS_DIRNAME);
    if (!existsSync(sessionsDir)) continue;
    for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'))) {
      const jsonlPath = join(sessionsDir, file);
      const meta = readSessionMeta(jsonlPath);
      if (!meta) continue;
      let updatedAt = meta.createdAt;
      try {
        updatedAt = statSync(jsonlPath).mtime.toISOString();
      } catch {}
      results.push({ ...meta, updatedAt, usage: readLastUsage(jsonlPath) });
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

export function readTranscript(cwd: string, sessionId: string): SessionEvent[] {
  return readHistory(sessionJsonlPathFromCwd(cwd, sessionId));
}

export function deleteSession(sessionId: string, cwd: string): void {
  const dir = dirname(sessionJsonlPathFromCwd(cwd, sessionId));
  if (!dir) return;
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const subagentDir = join(dir, sessionId);
  try {
    if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
  } catch {}
  try {
    if (existsSync(subagentDir)) rmSync(subagentDir, { recursive: true, force: true });
  } catch {}
}
