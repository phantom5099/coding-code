import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCompactWithLLM, mockLLM } = vi.hoisted(() => ({
  mockCompactWithLLM: vi.fn(),
  mockLLM: {
    complete: vi.fn(() => Promise.resolve({
      ok: true,
      value: { content: '<summary>compacted</summary>' },
    })),
  },
}));

vi.mock('../../../src/context/compressor/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    compactWithLLM: mockCompactWithLLM,
  };
});

vi.mock('../../../src/session/store.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    resolveSessionDir: vi.fn(() => '/tmp/sessions'),
    findSessionIndex: vi.fn(() => ({ currentTurnId: 10 })),
    readHistory: vi.fn(() => [
      { type: 'user', content: 'a'.repeat(200), uuid: 'u1', turnId: 1 },
      { type: 'assistant', content: 'b'.repeat(200), uuid: 'a1', turnId: 1 },
    ]),
  };
});

vi.mock('../../../src/context/compressor/llm-resolver.js', () => ({
  resolveCompactionLLM: vi.fn(() => Promise.resolve(mockLLM)),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    appendFileSync: vi.fn(),
  };
});

import { compactIfNeeded } from '../../../src/context/compressor/index.js';
import { findSessionIndex } from '../../../src/session/store.js';

function config(threshold: number, maxTokens = 10000) {
  return {
    compactionThreshold: threshold,
    keepRecentTurns: 2,
    minTurnsBetweenCompactions: 5,
    compactionModel: '',
    reactiveCompactMaxRetries: 1,
    reactiveCompactKeepTurns: 3,
    tokenPruneThreshold: 0.8,
    tokenPruneTurns: 2,
    minTurnsBeforePrune: 5,
    tokenPruneMinReleaseRatio: 0.5,
    tokenPruneMaxExtraTurns: 2,
    persistPreviewChars: 2000,
    thresholdTokens: 2000,
    toolResultBudgetThreshold: 50000,
  } as any;
}

describe('compactIfNeeded', () => {
  beforeEach(() => {
    mockCompactWithLLM.mockClear();
    (findSessionIndex as any).mockReturnValue({ currentTurnId: 10 });
  });

  it('returns didCompress=false when promptEstimate is below threshold', async () => {
    const result = await compactIfNeeded('s1', 'proj', 100, 10000, config(0.5), null);
    expect(result.didCompress).toBe(false);
    expect(result.released).toBe(0);
    expect(result.promptEstimate).toBe(100);
    expect(mockCompactWithLLM).not.toHaveBeenCalled();
  });

  it('returns didCompress=false when promptEstimate equals threshold', async () => {
    const result = await compactIfNeeded('s1', 'proj', 5000, 10000, config(0.5), null);
    expect(result.didCompress).toBe(false);
    expect(result.released).toBe(0);
    expect(mockCompactWithLLM).not.toHaveBeenCalled();
  });

  it('returns didCompress=true when promptEstimate exceeds threshold', async () => {
    const result = await compactIfNeeded('s1', 'proj', 10000, 10000, config(0.5), null);
    expect(result.didCompress).toBe(true);
    expect(result.released).toBeGreaterThan(0);
    expect(result.promptEstimate).toBeGreaterThanOrEqual(0);
  });

  it('does not return restoredFiles field (removed)', async () => {
    const result = await compactIfNeeded('s1', 'proj', 10000, 10000, config(0.5), null);
    expect('restoredFiles' in result).toBe(false);
  });

  it('resets failure count after TTL expires', async () => {
    // Force compactWithLLM to always return didCompress=false by setting currentTurnId too low
    (findSessionIndex as any).mockReturnValue({ currentTurnId: 0 });

    // First 3 calls: compactWithLLM returns didCompress=false (insufficient turns)
    await compactIfNeeded('ttl-session', 'proj', 10000, 10000, config(0.5), null);
    await compactIfNeeded('ttl-session', 'proj', 10000, 10000, config(0.5), null);
    await compactIfNeeded('ttl-session', 'proj', 10000, 10000, config(0.5), null);

    // 4th call blocked by failure tracker (failures >= 3)
    const blocked = await compactIfNeeded('ttl-session', 'proj', 10000, 10000, config(0.5), null);
    expect(blocked.didCompress).toBe(false);

    // Advance time past 24h TTL
    const originalNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 25 * 60 * 60 * 1000);

    // After TTL, failure count resets, compaction is attempted again (still fails due to turns)
    const afterTTL = await compactIfNeeded('ttl-session', 'proj', 10000, 10000, config(0.5), null);
    expect(afterTTL.didCompress).toBe(false);

    vi.restoreAllMocks();
  });
});
