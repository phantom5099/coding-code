import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { loadProjectionStore, appendProjection, rewindProjections, computeRanges } from '../../src/session/projection-store.js';
import type { ProjectionEntry } from '../../src/context/projection/types.js';

const SESSIONS_DIR = join(homedir(), '.codingcode', 'sessions');

describe('projection-store', () => {
  let sessionId: string;
  let slug: string;

  beforeEach(() => {
    sessionId = randomUUID();
    slug = randomUUID();
    const sessionDir = join(SESSIONS_DIR, slug);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${sessionId}.jsonl`), '', 'utf8');
  });

  afterEach(() => {
    const dir = join(SESSIONS_DIR, slug);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty store when no projections file exists', () => {
    const store = loadProjectionStore(sessionId);
    expect(store.projections).toEqual([]);
    expect(store.sessionId).toBe(sessionId);
    expect(store.version).toBe(2);
  });

  it('persists and loads projections', () => {
    const entry: ProjectionEntry = {
      type: 'message',
      id: 'm1',
      targetEventUuid: 't1',
      replacement: { role: 'tool', content: '[cleared]', tool_call_id: 'tc1' },
      originalTurnId: 1,
      method: 'prune',
      createdAt: new Date().toISOString(),
    };
    appendProjection(sessionId, entry);

    const store = loadProjectionStore(sessionId);
    expect(store.projections).toHaveLength(1);
    expect(store.projections[0]!.type).toBe('message');
    expect((store.projections[0]! as any).method).toBe('prune');
  });

  it('removes covered MessageProjections when adding RangeProjection', () => {
    const msgProj: ProjectionEntry = {
      type: 'message',
      id: 'm1',
      targetEventUuid: 't1',
      replacement: { role: 'tool', content: '[cleared]' },
      originalTurnId: 5,
      method: 'prune',
      createdAt: new Date().toISOString(),
    };
    appendProjection(sessionId, msgProj);

    const rangeProj: ProjectionEntry = {
      type: 'range',
      id: 'r1',
      turnRange: [1, 10],
      summaryMessages: [{ role: 'system', content: 'summary' }],
      method: 'auto-compact',
      createdAt: new Date().toISOString(),
    };
    appendProjection(sessionId, rangeProj);

    const store = loadProjectionStore(sessionId);
    expect(store.projections).toHaveLength(1);
    expect(store.projections[0]!.type).toBe('range');
  });

  it('rejects overlapping RangeProjections', () => {
    const r1: ProjectionEntry = {
      type: 'range',
      id: 'r1',
      turnRange: [1, 5],
      summaryMessages: [{ role: 'system', content: 's1' }],
      method: 'auto-compact',
      createdAt: new Date().toISOString(),
    };
    appendProjection(sessionId, r1);

    const r2: ProjectionEntry = {
      type: 'range',
      id: 'r2',
      turnRange: [3, 8],
      summaryMessages: [{ role: 'system', content: 's2' }],
      method: 'auto-compact',
      createdAt: new Date().toISOString(),
    };
    expect(() => appendProjection(sessionId, r2)).toThrow('overlaps');
  });

  it('rewindProjections removes projections after given turn', () => {
    const p1: ProjectionEntry = { type: 'message', id: 'm1', targetEventUuid: 't1', replacement: { role: 'tool', content: 'x' }, originalTurnId: 2, method: 'prune', createdAt: '' };
    const p2: ProjectionEntry = { type: 'message', id: 'm2', targetEventUuid: 't2', replacement: { role: 'tool', content: 'y' }, originalTurnId: 5, method: 'prune', createdAt: '' };
    appendProjection(sessionId, p1);
    appendProjection(sessionId, p2);

    rewindProjections(sessionId, 3);
    const store = loadProjectionStore(sessionId);
    expect(store.projections).toHaveLength(1);
    expect(store.projections[0]!.id).toBe('m1');
  });

  it('computeRanges merges overlapping intervals', () => {
    const ranges = computeRanges([
      { type: 'range' as const, id: 'r1', turnRange: [1, 5], summaryMessages: [], method: 'auto-compact', createdAt: '' },
      { type: 'range' as const, id: 'r2', turnRange: [4, 10], summaryMessages: [], method: 'auto-compact', createdAt: '' },
    ]);
    expect(ranges).toEqual([[1, 10]]);
  });
});
