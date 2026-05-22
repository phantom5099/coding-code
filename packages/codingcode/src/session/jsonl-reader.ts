import { existsSync, readFileSync, openSync, readSync, closeSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SessionEvent, SessionIndex } from './types.js';
import type { EnrichedMessage } from '../context/projection/types.js';
import { estimateTokensForContent } from '../context/utils/tokens.js';

function findSessionDir(sessionId: string): string | null {
  const { readdirSync } = require('fs') as typeof import('fs');
  const dir = join(homedir(), '.codingcode', 'sessions');
  if (!existsSync(dir)) return null;
  for (const slug of readdirSync(dir)) {
    const projectDir = join(dir, slug);
    if (existsSync(join(projectDir, `${sessionId}.jsonl`))) return projectDir;
  }
  return null;
}

function transcriptPath(sessionId: string): string {
  const dir = findSessionDir(sessionId);
  if (!dir) throw new Error(`Session ${sessionId} not found`);
  return join(dir, `${sessionId}.jsonl`);
}

function indexPath(sessionId: string): string {
  const dir = findSessionDir(sessionId);
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
