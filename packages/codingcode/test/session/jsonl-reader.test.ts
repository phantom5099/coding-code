import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { loadRawEvents, loadAllRawEvents, eventToEnriched } from '../../src/session/jsonl-reader.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

describe('jsonl-reader', () => {
  let sessionId: string;
  let slug: string;

  beforeEach(() => {
    sessionId = randomUUID();
    slug = randomUUID();
    const sessionDir = join(PROJECT_BASE, slug, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, `${sessionId}.jsonl`);
    const indexPath = join(sessionDir, `${sessionId}.index.json`);

    const lines = [
      { type: 'session_meta', sessionId, slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
      { type: 'user', turnId: 1, uuid: 'u1', content: 'hello', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 1, uuid: 'a1', content: 'hi there', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
      { type: 'tool_result', turnId: 2, uuid: 't1', parentUuid: 'a1', toolName: 'bash', toolCallId: 'tc1', output: 'result', timestamp: new Date().toISOString(), tokenCount: 5 },
    ];
    writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
    writeFileSync(indexPath, JSON.stringify({ sessionId, tokenCountEstimate: 5, projectedRanges: [], lastUncoveredByteOffset: 0, projectionCount: 0, lastCompressionFailures: 0 }, null, 2), 'utf8');
  });

  afterEach(() => {
    const dir = join(PROJECT_BASE, slug, 'sessions');
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('loadAllRawEvents reads all events from jsonl', () => {
    const events = loadAllRawEvents(sessionId);
    expect(events).toHaveLength(4);
    expect(events[0]!.type).toBe('session_meta');
    expect(events[1]!.type).toBe('user');
    expect(events[2]!.type).toBe('assistant');
    expect(events[3]!.type).toBe('tool_result');
  });

  it('loadRawEvents returns all events when no byte offset set', () => {
    const events = loadRawEvents(sessionId);
    expect(events).toHaveLength(4);
  });

  it('loadRawEvents skips covered events when lastUncoveredByteOffset is set', () => {
    const sessionDir = join(PROJECT_BASE, slug, 'sessions');
    const indexPath = join(sessionDir, `${sessionId}.index.json`);
    const offset = Buffer.byteLength(JSON.stringify({ type: 'session_meta', sessionId, slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' }) + '\n');
    writeFileSync(indexPath, JSON.stringify({ sessionId, tokenCountEstimate: 5, projectedRanges: [[1, 1]], lastUncoveredByteOffset: offset, projectionCount: 1, lastCompressionFailures: 0 }, null, 2), 'utf8');

    const events = loadRawEvents(sessionId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.type !== 'session_meta')).toBe(true);
  });

  it('eventToEnriched converts user event correctly', () => {
    const events = loadAllRawEvents(sessionId);
    const userEvent = events.find((e) => e.type === 'user')!;
    const enriched = eventToEnriched(userEvent);
    expect(enriched).not.toBeNull();
    expect(enriched!.message.role).toBe('user');
    expect(enriched!.message.content).toBe('hello');
    expect(enriched!.source.kind).toBe('raw');
  });

  it('eventToEnriched converts tool_result event', () => {
    const events = loadAllRawEvents(sessionId);
    const toolEvent = events.find((e) => e.type === 'tool_result')!;
    const enriched = eventToEnriched(toolEvent);
    expect(enriched).not.toBeNull();
    expect(enriched!.message.role).toBe('tool');
    expect(enriched!.message.tool_call_id).toBe('tc1');
  });

  it('eventToEnriched returns null for session_meta', () => {
    const events = loadAllRawEvents(sessionId);
    const metaEvent = events.find((e) => e.type === 'session_meta')!;
    const enriched = eventToEnriched(metaEvent);
    expect(enriched).toBeNull();
  });
});
