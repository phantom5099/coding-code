import { existsSync, readFileSync, openSync, readSync, closeSync, statSync } from 'fs';
import { join } from 'path';
import type { SessionEvent, SessionIndex } from './types.js';
import type { EnrichedMessage } from '../context/projection/types.js';
import { estimateTokensForContent } from '../context/utils/tokens.js';
import { resolveSessionDir } from './store.js';

function transcriptPath(sessionId: string): string {
  const dir = resolveSessionDir(sessionId);
  if (!dir) throw new Error(`Session ${sessionId} not found`);
  return join(dir, `${sessionId}.jsonl`);
}

function indexPath(sessionId: string): string {
  const dir = resolveSessionDir(sessionId);
  if (!dir) throw new Error(`Session ${sessionId} not found`);
  return join(dir, `${sessionId}.index.json`);
}

function loadIndex(sessionId: string): SessionIndex | null {
  try {
    return JSON.parse(readFileSync(indexPath(sessionId), 'utf8')) as SessionIndex;
  } catch {
    return null;
  }
}

export function loadRawEvents(sessionId: string): SessionEvent[] {
  const path = transcriptPath(sessionId);
  const index = loadIndex(sessionId);
  const offset = index?.lastUncoveredByteOffset ?? 0;
  if (offset > 0) return readJsonlFromByteOffset(path, offset);
  return readJsonlAll(path);
}

export function loadAllRawEvents(sessionId: string): SessionEvent[] {
  return readJsonlAll(transcriptPath(sessionId));
}

/**
 * Scan jsonl line by line, return the byte offset of the first event
 * with turnId === targetTurnId. Returns -1 if not found.
 */
export function findTurnFirstByteOffset(jsonlPath: string, targetTurnId: number): number {
  if (!existsSync(jsonlPath)) return -1;
  const content = readFileSync(jsonlPath, 'utf8');
  let offset = 0;
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      offset += line.length + 1;
      continue;
    }
    try {
      const ev = JSON.parse(line) as SessionEvent;
      if ('turnId' in ev && ev.turnId === targetTurnId) {
        return offset;
      }
    } catch { /* skip malformed */ }
    offset += Buffer.byteLength(line, 'utf8') + 1;
  }
  return -1;
}

/**
 * Compute byte offset to start reading from, given which turn ranges are
 * covered by RangeProjections. Only effective when ranges form a contiguous
 * prefix [1, N]; otherwise returns 0 (full read).
 */
export function computeUncoveredOffset(
  jsonlPath: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): number {
  if (ranges.length === 0) return 0;
  const sorted = [...ranges].map((r) => [r[0], r[1]] as [number, number]).sort((a, b) => a[0] - b[0]);
  if (sorted[0]![0] !== 1) return 0;
  let endOfPrefix = sorted[0]![1];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]![0] !== endOfPrefix + 1) break;
    endOfPrefix = sorted[i]![1];
  }
  const offset = findTurnFirstByteOffset(jsonlPath, endOfPrefix + 1);
  return offset >= 0 ? offset : 0;
}

export function transcriptPathOf(sessionId: string): string {
  return transcriptPath(sessionId);
}

export function indexPathOf(sessionId: string): string {
  return indexPath(sessionId);
}

function readJsonlAll(path: string): SessionEvent[] {
  if (!existsSync(path)) return [];
  return parseJsonlLines(readFileSync(path, 'utf8'));
}

function readJsonlFromByteOffset(path: string, byteOffset: number): SessionEvent[] {
  const size = statSync(path).size;
  if (byteOffset >= size) return [];

  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(size - byteOffset);
  readSync(fd, buffer, 0, buffer.length, byteOffset);
  closeSync(fd);

  return parseJsonlLines(buffer.toString('utf8'));
}

function parseJsonlLines(content: string): SessionEvent[] {
  return content.split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as SessionEvent);
}

export function eventToEnriched(event: SessionEvent): EnrichedMessage | null {
  switch (event.type) {
    case 'user':
      return {
        message: { role: 'user', content: event.content },
        turnId: event.turnId,
        uuid: event.uuid,
        source: { kind: 'raw', eventUuid: event.uuid },
      };
    case 'assistant': {
      const msg: any = { role: 'assistant', content: event.content };
      if (event.toolCalls && event.toolCalls.length > 0) {
        msg.tool_calls = event.toolCalls.map((tc: any) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
      }
      return {
        message: msg,
        turnId: event.turnId,
        uuid: event.uuid,
        source: { kind: 'raw', eventUuid: event.uuid },
      };
    }
    case 'tool_result':
      return {
        message: { role: 'tool', content: event.output, tool_call_id: event.toolCallId, tool_name: event.toolName },
        turnId: event.turnId,
        uuid: event.uuid,
        source: { kind: 'raw', eventUuid: event.uuid },
      };
    default:
      return null;
  }
}
