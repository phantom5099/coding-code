import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { loadAllRawEvents } from '../../src/session/jsonl-reader.js';
import { loadProjectionStore, appendProjection } from '../../src/session/projection-store.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

describe('TUI display vs LLM view', () => {
  const projectSlug = randomUUID();
  let sessionId: string;

  beforeEach(() => {
    sessionId = randomUUID();
    const sessionDir = join(PROJECT_BASE, projectSlug, 'sessions');
    mkdirSync(sessionDir, { recursive: true });

    // Write jsonl with 3 turns
    const transcriptPath = join(sessionDir, `${sessionId}.jsonl`);
    const lines = [
      { type: 'session_meta', sessionId, projectPath: projectSlug, cwd: '/tmp', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
      { type: 'user', turnId: 1, uuid: 'u1', content: 'make a website', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 1, uuid: 'a1', content: 'sure', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
      { type: 'user', turnId: 2, uuid: 'u2', content: 'add login', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 2, uuid: 'a2', content: 'ok', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
      { type: 'user', turnId: 3, uuid: 'u3', content: 'deploy', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 3, uuid: 'a3', content: 'done', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
    ];
    writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
    const indexPath = join(sessionDir, `${sessionId}.index.json`);
    writeFileSync(indexPath, JSON.stringify({ sessionId, tokenCountEstimate: 0, projectedRanges: [], lastUncoveredByteOffset: 0, projectionCount: 0, lastCompressionFailures: 0 }, null, 2), 'utf8');
  });

  afterEach(() => {
    const dir = join(PROJECT_BASE, projectSlug, 'sessions');
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('TUI sees all raw events', () => {
    const all = loadAllRawEvents(sessionId);
    expect(all).toHaveLength(7); // meta + 6 events
    // TUI sees the raw content
    const userEvents = all.filter((e) => e.type === 'user');
    expect(userEvents).toHaveLength(3);
    expect(userEvents[0]!.content).toBe('make a website');
  });

  it('TUI sees original content even after projection', () => {
    // Create a projection that covers turn 1
    appendProjection(sessionId, {
      type: 'range',
      id: 'r1',
      turnRange: [1, 1],
      summaryMessages: [{ role: 'system', content: 'compacted turn 1', name: 'compacted_history' }],
      method: 'auto-compact',
      createdAt: new Date().toISOString(),
    });

    // TUI still reads raw jsonl, not projections
    const all = loadAllRawEvents(sessionId);
    expect(all.filter((e) => e.type === 'user')).toHaveLength(3);
  });
});
