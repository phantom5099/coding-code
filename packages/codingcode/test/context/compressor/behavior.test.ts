import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { run, runL5 } from '../../../src/context/compressor/index.js';
import { loadProjectionStore } from '../../../src/session/projection-store.js';
import { __setContextConfigForTest } from '../../../src/context/config.js';
import type { ContextConfig } from '../../../src/context/config.js';
import type { LLMClient } from '../../../src/llm/client.js';
import { Result } from '../../../src/core/result.js';
import type { SessionIndex } from '../../../src/session/types.js';

const SESSIONS_DIR = join(homedir(), '.codingcode', 'sessions');

interface FixtureOptions {
  numTurns: number;
  toolContentSize?: number;
  toolName?: string;
  currentTurnId?: number;
}

function makeFixture(opts: FixtureOptions) {
  const sessionId = randomUUID();
  const slug = randomUUID();
  const dir = join(SESSIONS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    { type: 'session_meta', sessionId, projectSlug: slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
  ];

  const toolContent = 'X'.repeat(opts.toolContentSize ?? 8000);
  for (let turn = 1; turn <= opts.numTurns; turn++) {
    lines.push({ type: 'user', turnId: turn, uuid: `u${turn}`, content: `q${turn}`, timestamp: new Date().toISOString() });
    lines.push({ type: 'assistant', turnId: turn, uuid: `a${turn}`, content: `r${turn}`, toolCalls: [{ id: `tc${turn}`, name: opts.toolName ?? 'bash', arguments: '{}' }], model: 'test', timestamp: new Date().toISOString() });
    lines.push({ type: 'tool_result', turnId: turn, uuid: `t${turn}`, parentUuid: `a${turn}`, toolName: opts.toolName ?? 'bash', toolCallId: `tc${turn}`, output: toolContent, timestamp: new Date().toISOString(), tokenCount: Math.ceil(toolContent.length / 3.5) });
  }

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId, projectSlug: slug, cwd: '/tmp/test', model: 'test',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: opts.numTurns * 3, title: 'fixture', currentTurnId: opts.currentTurnId ?? opts.numTurns,
    tokenCountEstimate: 0, projectedRanges: [], lastUncoveredByteOffset: 0,
    projectionCount: 0, lastCompressionFailures: 0,
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { sessionId, slug, dir, transcriptPath, indexPath };
}

function cleanup(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function tinyConfig(overrides: Partial<ContextConfig> = {}): ContextConfig {
  return {
    defaultMaxTokens: 1000,
    reservedTokens: 0,
    thresholds: { budgetReduction: 0.1, prune: 0.2, slidingWindow: 0.3, collapse: 0.4, compaction: 0.5 },
    budgetReductionMaxTokensPerTool: 100,
    budgetReductionKeepLines: 5,
    pruneProtectedTokens: 100,
    pruneMinRelease: 1,
    slidingWindowCandidates: [10, 6, 4, 2],
    collapseMinTokens: 50,
    collapseSummaryMaxTokens: 100,
    toolsExemptFromPrune: [],
    toolsExemptFromTruncation: [],
    prefixTurnsProtected: 1,
    minTurnsBetweenCompactions: 3,
    L5KeepRecentTurns: 2,
    compactionModel: '',
    archiveTtlDays: 30,
    checkpointKeep: 50,
    ...overrides,
  };
}

function makeMockLLM(content: string): LLMClient {
  return {
    complete: async () => Result.ok({ content, finishReason: 'stop' as const }),
    completeStream: () => ({
      stream: (async function* () { yield content; })(),
      response: Promise.resolve(Result.ok({ content, finishReason: 'stop' as const })),
    }),
    modelInfo: { provider: 'mock', model: 'mock', maxTokens: 1000, supportsToolCalling: false, supportsStreaming: true },
  };
}

describe('compressor behavior', () => {
  afterEach(() => {
    __setContextConfigForTest({} as any);
  });

  describe('L2 prune protection', () => {
    it('does not prune tools in protected recent turns (prefixTurnsProtected)', async () => {
      const fx = makeFixture({ numTurns: 3, toolContentSize: 4000 });
      try {
        const cfg = tinyConfig({ prefixTurnsProtected: 2, pruneProtectedTokens: 0 });
        // currentTurnId=3, prefixTurnsProtected=2 → cutoff = 3-2-1 = 0, so no tool is prunable
        await run(fx.sessionId, 10000, null, cfg);
        const store = loadProjectionStore(fx.sessionId);
        expect(store.projections.filter((p) => p.type === 'message' && p.method === 'prune')).toHaveLength(0);
      } finally { cleanup(fx.dir); }
    });

    it('respects pruneProtectedTokens window (recent tools by token budget)', async () => {
      const fx = makeFixture({ numTurns: 5, toolContentSize: 4000 });
      try {
        // Each tool ~1143 tokens. pruneProtectedTokens=3000 → protect 3 most recent.
        const cfg = tinyConfig({ prefixTurnsProtected: 0, pruneProtectedTokens: 3000 });
        await run(fx.sessionId, 100000, null, cfg);
        const store = loadProjectionStore(fx.sessionId);
        const pruned = store.projections.filter((p) => p.type === 'message' && p.method === 'prune');
        // Only old tools (turn 1, 2) should be pruned; recent tools (3, 4, 5) protected by token budget.
        for (const p of pruned) {
          expect((p as any).originalTurnId).toBeLessThanOrEqual(2);
        }
      } finally { cleanup(fx.dir); }
    });

    it('skips whitelisted tools', async () => {
      const fx = makeFixture({ numTurns: 5, toolContentSize: 4000, toolName: 'Read' });
      try {
        const cfg = tinyConfig({ prefixTurnsProtected: 0, pruneProtectedTokens: 0, toolsExemptFromPrune: ['Read'] });
        await run(fx.sessionId, 100000, null, cfg);
        const store = loadProjectionStore(fx.sessionId);
        expect(store.projections.filter((p) => p.type === 'message' && p.method === 'prune')).toHaveLength(0);
      } finally { cleanup(fx.dir); }
    });
  });

  describe('fall-through L2→L4→L5', () => {
    it('falls through to L5 when prune and collapse have no candidates', async () => {
      const fx = makeFixture({ numTurns: 6, toolContentSize: 4000, toolName: 'Read' });
      try {
        // Whitelist Read for both L2 and L4; usage way above all thresholds.
        const cfg = tinyConfig({
          toolsExemptFromPrune: ['Read'],
          prefixTurnsProtected: 0,
          pruneProtectedTokens: 0,
          collapseMinTokens: 999_999, // disable L4
          minTurnsBetweenCompactions: 2,
          L5KeepRecentTurns: 2,
        });
        const llm = makeMockLLM('## Compacted History\n\n### Goal\nx\n\n### Instructions\ny\n\n### Discoveries\nz\n\n### Accomplished\nw\n\n### Relevant Files\nv');
        const result = await run(fx.sessionId, 100000, llm, cfg);
        const store = loadProjectionStore(fx.sessionId);
        const ranges = store.projections.filter((p) => p.type === 'range');
        expect(ranges.length).toBe(1);
        expect(result.didCompress).toBe(true);
      } finally { cleanup(fx.dir); }
    });
  });

  describe('L5 compaction', () => {
    it('writes RangeProjection with five-section system summary', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const cfg = tinyConfig({ minTurnsBetweenCompactions: 3, L5KeepRecentTurns: 2 });
        const summary = '## Compacted History\n\n### Goal\nfix bug\n\n### Instructions\nbe careful\n\n### Discoveries\nrace condition\n\n### Accomplished\npatched\n\n### Relevant Files\nsrc/x.ts';
        const llm = makeMockLLM(summary);
        await runL5(fx.sessionId, cfg, llm);
        const store = loadProjectionStore(fx.sessionId);
        const ranges = store.projections.filter((p) => p.type === 'range') as any[];
        expect(ranges.length).toBe(1);
        expect(ranges[0]!.turnRange).toEqual([1, 3]);
        expect(ranges[0]!.summaryMessages[0]!.role).toBe('system');
        expect(ranges[0]!.summaryMessages[0]!.name).toBe('compacted_history');
        expect(ranges[0]!.summaryMessages[0]!.content).toContain('### Goal');
      } finally { cleanup(fx.dir); }
    });

    it('skips L5 when not enough turns to satisfy minTurnsBetweenCompactions', async () => {
      const fx = makeFixture({ numTurns: 3 });
      try {
        const cfg = tinyConfig({ minTurnsBetweenCompactions: 5, L5KeepRecentTurns: 1 });
        const llm = makeMockLLM('summary');
        const result = await runL5(fx.sessionId, cfg, llm);
        expect(result.didCompress).toBe(false);
        const store = loadProjectionStore(fx.sessionId);
        expect(store.projections.filter((p) => p.type === 'range')).toHaveLength(0);
      } finally { cleanup(fx.dir); }
    });

    it('returns no-op when no LLM available', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const cfg = tinyConfig({ minTurnsBetweenCompactions: 3, L5KeepRecentTurns: 2 });
        const result = await runL5(fx.sessionId, cfg, null);
        expect(result.didCompress).toBe(false);
        const store = loadProjectionStore(fx.sessionId);
        expect(store.projections.filter((p) => p.type === 'range')).toHaveLength(0);
      } finally { cleanup(fx.dir); }
    });
  });

  describe('L5 token efficiency', () => {
    it('feeds the LLM the post-projection view (already-pruned tools sent as replacement, not raw)', async () => {
      const fx = makeFixture({ numTurns: 5, toolContentSize: 4000 });
      try {
        // Step 1: write a prune projection on tool t1 first (simulate prior L2)
        const { appendProjection } = await import('../../../src/session/projection-store.js');
        appendProjection(fx.sessionId, {
          type: 'message',
          id: 'pre-pruned',
          targetEventUuid: 't1',
          replacement: { role: 'tool', content: '[Old tool result content cleared]', tool_call_id: 'tc1' },
          originalTurnId: 1,
          method: 'prune',
          createdAt: new Date().toISOString(),
        });

        // Step 2: capture what the L5 LLM gets called with
        let capturedUserContent = '';
        const captureLLM: LLMClient = {
          complete: async (req) => {
            capturedUserContent = req.messages[0]!.content;
            return Result.ok({ content: '## Compacted History\n\n### Goal\nx\n\n### Instructions\ny\n\n### Discoveries\nz\n\n### Accomplished\nw\n\n### Relevant Files\nv', finishReason: 'stop' as const });
          },
          completeStream: () => ({ stream: (async function* () {})(), response: Promise.resolve(Result.ok({ content: '', finishReason: 'stop' as const })) }),
          modelInfo: { provider: 'capture', model: 'capture', maxTokens: 1000, supportsToolCalling: false, supportsStreaming: false },
        };

        const cfg = tinyConfig({ minTurnsBetweenCompactions: 3, L5KeepRecentTurns: 2 });
        await runL5(fx.sessionId, cfg, captureLLM);

        // Assert: t1's raw 4000-char content should NOT appear; the replacement should.
        expect(capturedUserContent).toContain('[Old tool result content cleared]');
        // The raw 'XXXX...' content for t1 must not appear (saving tokens).
        // Other turns (t2..t3) raw content WILL appear since those weren't pre-pruned.
        // Use a tight check: the count of 'X' runs should be lower than if all 5 turns were sent raw.
        const xCount = (capturedUserContent.match(/X/g) || []).length;
        // Only turns 2,3 in range (1..endTurn=3, so 1,2,3); turn 1 was replaced. Turn 1's 4000 X's saved.
        // So xCount ≈ 2 * 4000 = 8000, not 3 * 4000 = 12000.
        expect(xCount).toBeLessThan(3 * 4000);
        expect(xCount).toBeGreaterThan(1 * 4000);
      } finally { cleanup(fx.dir); }
    });
  });

  describe('appendProjection updates index', () => {
    it('updates projectedRanges, projectionCount, lastUncoveredByteOffset after L5', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const cfg = tinyConfig({ minTurnsBetweenCompactions: 3, L5KeepRecentTurns: 2 });
        const llm = makeMockLLM('## Compacted History\n\n### Goal\na\n\n### Instructions\nb\n\n### Discoveries\nc\n\n### Accomplished\nd\n\n### Relevant Files\ne');
        await runL5(fx.sessionId, cfg, llm);

        const idx = JSON.parse(readFileSync(fx.indexPath, 'utf8')) as SessionIndex;
        expect(idx.projectionCount).toBe(1);
        expect(idx.projectedRanges).toEqual([[1, 3]]);
        expect(idx.lastProjectionAt).toBeTruthy();
        // Range covers turn 1-3; lastUncoveredByteOffset should point at first byte of turn 4
        expect(idx.lastUncoveredByteOffset).toBeGreaterThan(0);
      } finally { cleanup(fx.dir); }
    });
  });
});
