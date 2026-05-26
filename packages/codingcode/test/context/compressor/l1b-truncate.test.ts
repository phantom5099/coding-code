import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { run } from '../../../src/context/compressor/index.js';
import { loadProjectionStore } from '../../../src/session/projection-store.js';
import type { ContextConfig } from '../../../src/context/config.js';
import type { SessionIndex } from '../../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function makeFixture(sessionId: string, slug: string, toolOutput: string) {
  const dir = join(PROJECT_BASE, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    { type: 'session_meta', sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
    { type: 'user', turnId: 1, uuid: 'u1', content: 'q1', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 1, uuid: 'a1', content: 'r1', toolCalls: [{ id: 'tc1', name: 'Read', arguments: '{}' }], model: 'test', timestamp: new Date().toISOString() },
    { type: 'tool_result', turnId: 1, uuid: 't1', parentUuid: 'a1', toolName: 'Read', toolCallId: 'tc1', output: toolOutput, timestamp: new Date().toISOString(), tokenCount: 2000 },
  ];

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: 3, title: 'fixture', currentTurnId: 1,
    tokenCountEstimate: 0, projectedRanges: [], lastUncoveredByteOffset: 0,
    projectionCount: 0, lastCompressionFailures: 0,
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

function l1bCfg(): ContextConfig {
  return {
    defaultMaxTokens: 10000,
    reservedTokens: 0,
    thresholds: { budgetReduction: 0.01, prune: 0.99, compaction: 0.99 },
    pruneProtectedTokens: 0,
    pruneMinRelease: 1,
    toolsExemptFromPrune: [],
    prefixTurnsProtected: 0,
    minTurnsBetweenCompactions: 1,
    keepRecentTurns: 999,
    compactionModel: '',
    archiveTtlDays: 30,
    checkpointKeep: 50,
    thresholdTokens: 1, // trigger on any content
    truncateKeepHeadLines: 2,
    truncateKeepTailLines: 2,
    persistPreviewChars: 2000,
    persistableTools: [], // Read is NOT persistable â†?goes to truncation
    reactiveCompactMaxRetries: 1,
    reactiveCompactKeepTurns: 3,
    snipMaxMessages: 999,
    snipKeepHead: 3,
    microKeepRecentTools: 999,
  };
}

describe('L1b truncation', () => {
  it('creates collapse-rule projection for large non-persistable tool results', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    // 100 lines of content: truncation saves tokens vs the full output + recovery hint overhead
    const longContent = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    const fx = makeFixture(sessionId, slug, longContent);
    try {
      run(sessionId, 1000, null, l1bCfg());
      const store = loadProjectionStore(sessionId);
      const msgs = store.projections.filter((p) => p.type === 'message');
      expect(msgs.length).toBe(1);
      expect((msgs[0] as any).method).toBe('collapse-rule');
      const replacement = (msgs[0] as any).replacement.content;
      expect(replacement).toContain('omitted');
      expect(replacement).toContain('line 1');
      expect(replacement).toContain('line 99');
    } finally { rmSync(fx.dir, { recursive: true, force: true }); }
  });

  it('does nothing when tool is under threshold', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, 'short');
    try {
      const cfg = { ...l1bCfg(), thresholdTokens: 9999 };
      run(sessionId, 1000, null, cfg);
      const store = loadProjectionStore(sessionId);
      expect(store.projections.filter((p) => p.type === 'message')).toHaveLength(0);
    } finally { rmSync(fx.dir, { recursive: true, force: true }); }
  });
});
