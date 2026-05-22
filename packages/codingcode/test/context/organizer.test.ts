import { describe, it, expect } from 'vitest';
import { fitToBudget } from '../../src/context/organizer.js';
import type { Message } from '../../src/core/types.js';
import type { ContextConfig } from '../../src/context/config.js';

function msg(content: string, role: Message['role'] = 'user'): Message {
  return { role, content };
}

const testConfig: ContextConfig = {
  defaultMaxTokens: 1000,
  reservedTokens: 100,
  thresholds: { budgetReduction: 0.6, prune: 0.7, slidingWindow: 0.75, collapse: 0.8, compaction: 0.9 },
  budgetReductionMaxTokensPerTool: 2000,
  budgetReductionKeepLines: 20,
  pruneProtectedTokens: 40000,
  pruneMinRelease: 20000,
  slidingWindowCandidates: [10, 6, 4, 2],
  collapseMinTokens: 500,
  collapseSummaryMaxTokens: 1500,
  toolsExemptFromPrune: ['Read'],
  toolsExemptFromTruncation: ['Read'],
  prefixTurnsProtected: 1,
  minTurnsBetweenCompactions: 5,
  L5KeepRecentTurns: 10,
  compactionFuseMaxFailures: 3,
  compactionModel: 'haiku',
  archiveTtlDays: 30,
  checkpointKeep: 50,
};

describe('fitToBudget', () => {
  it('returns messages unchanged when under budget', () => {
    const messages = [msg('short')];
    const result = fitToBudget(messages, testConfig);
    expect(result).toEqual(messages);
  });

  it('removes oldest non-pinned messages when over budget', () => {
    // Each message ~1600 chars → ~457 tokens; budget = 900
    // pinned(4) + 1600(457) + 1600(457) = 918 > 900 → remove one
    // pinned(4) + 1600(457) = 461 ≤ 900 → stop, 2 remaining
    const messages = [msg('pinned', 'system'), msg('x'.repeat(1600)), msg('y'.repeat(1600))];
    const result = fitToBudget(messages, testConfig, 1); // 1 pinned
    expect(result.length).toBe(2); // pinned + 1 remaining long msg
    expect(result[0]!.content).toBe('pinned'); // pinned stays
  });

  it('removes oldest non-pinned messages when over budget, falls back to fitToBudget', () => {
    // No pinned, 3 huge messages → should trim to under budget
    const messages = [msg('a'.repeat(4000)), msg('b'.repeat(4000)), msg('c'.repeat(4000))];
    const result = fitToBudget(messages, testConfig, 0);
    expect(result.length).toBeLessThan(3); // at least 1 removed
  });
});
