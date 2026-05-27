import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { run } from '../../../src/context/compressor/index.js';
import type { ContextConfig } from '../../../src/context/config.js';
import type { SessionIndex, SessionEvent, SummaryEvent } from '../../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function makeFixture(sessionId: string, slug: string, numTurns: number) {
  const dir = join(PROJECT_BASE, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    { type: 'session_meta', sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
  ];

  for (let turn = 1; turn <= numTurns; turn++) {
    lines.push({ type: 'user', turnId: turn, uuid: `u${turn}`, content: `q${turn}`, timestamp: new Date().toISOString() });
    lines.push({ type: 'assistant', turnId: turn, uuid: `a${turn}`, content: `r${turn}`, toolCalls: [{ id: `tc${turn}`, name: 'bash', arguments: '{}' }], model: 'test', timestamp: new Date().toISOString() });
    lines.push({ type: 'tool_result', turnId: turn, uuid: `t${turn}`, parentUuid: `a${turn}`, toolName: 'bash', toolCallId: `tc${turn}`, output: 'result', timestamp: new Date().toISOString(), tokenCount: 10 });
  }

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: numTurns * 3, title: 'fixture', currentTurnId: numTurns,
    tokenCountEstimate: 0, permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

function readSummaryEvents(jsonlPath: string): SummaryEvent[] {
  const content = readFileSync(jsonlPath, 'utf8');
  return content.split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SessionEvent)
    .filter((ev): ev is SummaryEvent => ev.type === 'summary');
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
    keepRecentTurns: 999,
    compactionModel: '',
    archiveTtlDays: 30,
    checkpointKeep: 50,
    thresholdTokens: 999_999,
    truncateKeepHeadLines: 5,
    truncateKeepTailLines: 15,
    persistPreviewChars: 2000,
    persistableTools: [],
    reactiveCompactMaxRetries: 1,
    reactiveCompactKeepTurns: 3,
    snipMaxMessages: 4,
    snipKeepHead: 1,
    microKeepRecentTools: 999,
  };
}

describe('L2 Snip', () => {
  it('creates summary event when message count exceeds snipMaxMessages', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, 3); // 9 messages > 4
    try {
      await run(sessionId, 1000, null, snipCfg());
      const summaries = readSummaryEvents(fx.transcriptPath);
      const snipSummaries = summaries.filter((s) => s.method === 'context-collapse');
      expect(snipSummaries).toHaveLength(1);
      expect(snipSummaries[0]!.replaces.length).toBeGreaterThan(0);
    } finally { rmSync(fx.dir, { recursive: true, force: true }); }
  });

  it('does nothing when under snipMaxMessages', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, 1); // 3 messages < 4
    try {
      const cfg = { ...snipCfg(), snipMaxMessages: 999 };
      await run(sessionId, 1000, null, cfg);
      const summaries = readSummaryEvents(fx.transcriptPath);
      expect(summaries).toHaveLength(0);
    } finally { rmSync(fx.dir, { recursive: true, force: true }); }
  });
});
