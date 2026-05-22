import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { run } from '../../../src/context/compressor/index.js';
import { loadProjectionStore } from '../../../src/session/projection-store.js';
import type { ContextConfig } from '../../../src/context/config.js';
import type { SessionIndex } from '../../../src/session/types.js';

const SESSIONS_DIR = join(homedir(), '.codingcode', 'sessions');

function makeFixture(sessionId: string, slug: string, numTurns: number) {
  const dir = join(SESSIONS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    { type: 'session_meta', sessionId, projectSlug: slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
  ];

  for (let turn = 1; turn <= numTurns; turn++) {
    lines.push({ type: 'user', turnId: turn, uuid: `u${turn}`, content: `q${turn}`, timestamp: new Date().toISOString() });
    lines.push({ type: 'assistant', turnId: turn, uuid: `a${turn}`, content: `r${turn}`, toolCalls: [{ id: `tc${turn}`, name: 'bash', arguments: '{}' }], model: 'test', timestamp: new Date().toISOString() });
    lines.push({ type: 'tool_result', turnId: turn, uuid: `t${turn}`, parentUuid: `a${turn}`, toolName: 'bash', toolCallId: `tc${turn}`, output: 'result', timestamp: new Date().toISOString(), tokenCount: 10 });
  }

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId, projectSlug: slug, cwd: '/tmp/test', model: 'test',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: numTurns * 3, title: 'fixture', currentTurnId: numTurns,
    tokenCountEstimate: 0, projectedRanges: [], lastUncoveredByteOffset: 0,
    projectionCount: 0, lastCompressionFailures: 0,
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

function snipCfg(): ContextConfig {
  return {
    defaultMaxTokens: 10000,
    reservedTokens: 0,
    thresholds: { budgetReduction: 0.1, prune: 0.99, compaction: 0.99 },
    pruneProtectedTokens: 0,
    pruneMinRelease: 1,
    toolsExemptFromPrune: [],
    prefixTurnsProtected: 0,
    minTurnsBetweenCompactions: 1,
    L5KeepRecentTurns: 999,
    compactionModel: '',
    archiveTtlDays: 30,
    checkpointKeep: 50,
    l1ThresholdTokens: 999_999,
    l1TruncateKeepHeadLines: 5,
    l1TruncateKeepTailLines: 15,
    l1PersistPreviewChars: 2000,
    l1PersistableTools: [],
    reactiveCompactMaxRetries: 1,
    reactiveCompactKeepTurns: 3,
    snipMaxMessages: 4,
    snipKeepHead: 1,
    microKeepRecentTools: 999,
  };
}

describe('L2 Snip', () => {
  it('creates RangeProjection when message count exceeds snipMaxMessages', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, 3); // 9 messages > 4
    try {
      run(sessionId, 1000, null, snipCfg());
      const store = loadProjectionStore(sessionId);
      const ranges = store.projections.filter((p) => p.type === 'range');
      expect(ranges).toHaveLength(1);
    } finally { rmSync(fx.dir, { recursive: true, force: true }); }
  });

  it('does nothing when under snipMaxMessages', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, 1); // 3 messages ≤ 4
    try {
      const cfg = { ...snipCfg(), snipMaxMessages: 999 };
      run(sessionId, 1000, null, cfg);
      const store = loadProjectionStore(sessionId);
      expect(store.projections.filter((p) => p.type === 'range')).toHaveLength(0);
    } finally { rmSync(fx.dir, { recursive: true, force: true }); }
  });
});
