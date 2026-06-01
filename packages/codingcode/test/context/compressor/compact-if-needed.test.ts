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

vi.mock('../../../src/context/persist/store.js', () => ({
  persistToolResult: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    appendFileSync: vi.fn(),
  };
});

import { compactIfNeeded } from '../../../src/context/compressor/index.js';

function config(threshold: number, maxTokens = 10000) {
  return {
    defaultMaxTokens: maxTokens,
    thresholds: { prune: threshold, compaction: threshold },
    keepRecentTurns: 2,
    minTurnsBetweenCompactions: 5,
    l5Compaction: { summaryModel: 'test', summaryTemperature: 0 },
  } as any;
}

describe('compactIfNeeded', () => {
  beforeEach(() => {
    mockCompactWithLLM.mockClear();
  });

  it('returns didCompress=false when promptEstimate is below threshold', async () => {
    const result = await compactIfNeeded('s1', 'proj', 100, config(0.5), null);
    expect(result.didCompress).toBe(false);
    expect(result.released).toBe(0);
    expect(result.promptEstimate).toBe(100);
    expect(mockCompactWithLLM).not.toHaveBeenCalled();
  });

  it('returns didCompress=false when promptEstimate equals threshold', async () => {
    const result = await compactIfNeeded('s1', 'proj', 5000, config(0.5), null);
    expect(result.didCompress).toBe(false);
    expect(result.released).toBe(0);
    expect(mockCompactWithLLM).not.toHaveBeenCalled();
  });

  it('returns didCompress=true when promptEstimate exceeds threshold', async () => {
    const result = await compactIfNeeded('s1', 'proj', 10000, config(0.5), null);
    expect(result.didCompress).toBe(true);
    expect(result.released).toBeGreaterThan(0);
    expect(result.promptEstimate).toBeGreaterThanOrEqual(0);
  });

  it('does not return restoredFiles field (removed)', async () => {
    const result = await compactIfNeeded('s1', 'proj', 10000, config(0.5), null);
    expect('restoredFiles' in result).toBe(false);
  });
});
