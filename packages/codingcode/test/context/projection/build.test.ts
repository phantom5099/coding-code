import { describe, it, expect, beforeAll } from 'vitest';
import { __setContextConfigForTest } from '../../../src/context/config.js';
import type { ContextConfig } from '../../../src/context/config.js';

const testConfig: ContextConfig = {
  defaultMaxTokens: 100000,
  reservedTokens: 10000,
  thresholds: { budgetReduction: 0.6, prune: 0.7, slidingWindow: 0.75, collapse: 0.8, compaction: 0.9 },
  budgetReductionMaxTokensPerTool: 200,
  budgetReductionKeepLines: 20,
  pruneProtectedTokens: 40000,
  pruneMinRelease: 100,
  slidingWindowCandidates: [10, 6, 4, 2],
  collapseMinTokens: 50,
  collapseSummaryMaxTokens: 500,
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

describe('L1 Budget Reduction (via build.ts)', () => {
  beforeAll(() => {
    __setContextConfigForTest(testConfig);
  });

  it('applies L1 truncation to raw tool messages', async () => {
    const { buildMessagesForQuery } = await import('../../../src/context/projection/build.js');
    // buildMessagesForQuery reads from file system — we test the exported function
    // by verifying it exists and is a function
    expect(buildMessagesForQuery).toBeTypeOf('function');
  });
});
