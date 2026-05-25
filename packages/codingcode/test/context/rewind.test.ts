import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { loadProjectionStore, appendProjection, rewindProjections } from '../../src/session/projection-store.js';
import { enqueueTask, truncateJsonl } from '../../src/session/store.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

describe('rewind', () => {
  let sessionId: string;
  let slug: string;
  let transcriptPath: string;

  beforeEach(() => {
    sessionId = randomUUID();
    slug = randomUUID();
    const sessionDir = join(PROJECT_BASE, slug, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    transcriptPath = join(sessionDir, `${sessionId}.jsonl`);

    // Write 5 turns of events
    const lines: any[] = [{ type: 'session_meta', sessionId, slug, cwd: '/tmp', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' }];
    for (let t = 1; t <= 5; t++) {
      lines.push({ type: 'user', turnId: t, uuid: `u${t}`, content: `q${t}`, timestamp: '' });
      lines.push({ type: 'assistant', turnId: t, uuid: `a${t}`, content: `a${t}`, toolCalls: [], model: 'test', timestamp: '' });
    }
    writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

    // Add projections for turn 3-5
    appendProjection(sessionId, {
      type: 'message',
      id: 'm1',
      targetEventUuid: 't3',
      replacement: { role: 'tool', content: '[cleared]' },
      originalTurnId: 3,
      method: 'prune',
      createdAt: '',
    });
    appendProjection(sessionId, {
      type: 'range',
      id: 'r1',
      turnRange: [4, 5],
      summaryMessages: [{ role: 'system', content: 'compacted' }],
      method: 'auto-compact',
      createdAt: '',
    });

    const indexPath = join(sessionDir, `${sessionId}.index.json`);
    writeFileSync(indexPath, JSON.stringify({
      sessionId, currentTurnId: 5, messageCount: 11,
      tokenCountEstimate: 100, projectedRanges: [[4, 5]], lastUncoveredByteOffset: 200, projectionCount: 2,
      lastCompressionFailures: 0, createdAt: '', updatedAt: '',
      slug, cwd: '/tmp', model: 'test', title: 'test',
    }, null, 2), 'utf8');
  });

  afterEach(() => {
    const dir = join(PROJECT_BASE, slug, 'sessions');
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('rewindProjections removes projections after turn 3', () => {
    rewindProjections(sessionId, 3);
    const store = loadProjectionStore(sessionId);
    expect(store.projections).toHaveLength(1);
    expect(store.projections[0]!.id).toBe('m1'); // turn 3 survives
  });

  it('truncateJsonl truncates file at byte offset', () => {
    const content = readFileSync(transcriptPath, 'utf8');
    const metaLine = content.split('\n')[0]!;
    const offset = Buffer.byteLength(metaLine + '\n');

    truncateJsonl(transcriptPath, offset);
    const remaining = readFileSync(transcriptPath, 'utf8').trim();
    expect(JSON.parse(remaining).type).toBe('session_meta');
  });
});
