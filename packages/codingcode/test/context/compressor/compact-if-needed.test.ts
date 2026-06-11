import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCompactWithLLM, mockLLM } = vi.hoisted(() => ({
  mockCompactWithLLM: vi.fn(),
  mockLLM: {
    complete: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: { content: '<summary>compacted</summary>' },
      })
    ),
    completeStream: () => ({
      stream: (async function* () {})(),
      response: Promise.resolve({
        ok: true as const,
        value: { content: '<summary>compacted</summary>' },
      }),
    }),
    modelInfo: {
      provider: 'mock',
      model: 'mock',
      maxTokens: 100000,
      supportsToolCalling: false,
      supportsStreaming: true,
    },
  },
}));

vi.mock('../../../src/session/io.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    findSessionIndex: vi.fn(() => ({ currentTurnId: 10 })),
    resolveSessionDir: vi.fn(() => '/tmp/sessions'),
    readHistory: vi.fn(() => [
      { type: 'user', content: 'a'.repeat(200), uuid: 'u1', turnId: 1 },
      { type: 'assistant', content: 'b'.repeat(200), uuid: 'a1', turnId: 1 },
    ]),
  };
});

vi.mock('../../../src/llm/llm-resolver.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    resolveLLM: vi.fn(() => Promise.resolve(mockLLM)),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    appendFileSync: vi.fn(),
  };
});

vi.mock('../../../src/context/util.js', () => ({
  estimateTokens: vi.fn(),
  estimateMessageTokens: vi.fn(),
  estimateTokensForContent: vi.fn(),
}));

import { compactIfNeeded } from '../../../src/context/compressor.js';
import { findSessionIndex } from '../../../src/session/io.js';
import { estimateTokens, estimateMessageTokens } from '../../../src/context/util.js';

function config(threshold: number, maxTokens = 10000) {
  return {
    microCompactThreshold: 0.5,
    microCompactMinChars: 120,
    compactionThreshold: threshold,
    keepRecentTurns: 1,
    compactionModel: '',
    reactiveCompactMaxRetries: 1,
  } as any;
}

describe('compactIfNeeded', () => {
  beforeEach(() => {
    mockCompactWithLLM.mockClear();
    (findSessionIndex as any).mockReturnValue({ currentTurnId: 10 });
    (estimateTokens as any).mockReturnValue(0);
    (estimateMessageTokens as any).mockReturnValue(50);
    mockCompactWithLLM.mockResolvedValue({
      didCompress: true,
      released: 1000,
      promptEstimate: 5000,
    });
  });

  it('returns didCompress=false when promptEstimate is below threshold', async () => {
    (estimateTokens as any).mockReturnValue(100);
    const result = await compactIfNeeded('s1', 'proj', [], 10000, config(0.5), null);
    expect(result.didCompress).toBe(false);
    expect(result.released).toBe(0);
    expect(result.promptEstimate).toBe(100);
    expect(mockCompactWithLLM).not.toHaveBeenCalled();
  });

  it('returns didCompress=false when promptEstimate equals threshold', async () => {
    (estimateTokens as any).mockReturnValue(5000);
    const result = await compactIfNeeded('s1', 'proj', [], 10000, config(0.5), null);
    expect(result.didCompress).toBe(false);
    expect(result.released).toBe(0);
    expect(mockCompactWithLLM).not.toHaveBeenCalled();
  });

  it('returns didCompress=true when promptEstimate exceeds threshold', async () => {
    (estimateTokens as any).mockReturnValue(10000);
    const result = await compactIfNeeded('s1', 'proj', [], 10000, config(0.5), null);
    expect(result.didCompress).toBe(true);
    expect(result.released).toBeGreaterThan(0);
    expect(result.promptEstimate).toBeGreaterThanOrEqual(0);
  });

  it('does not return restoredFiles field (removed)', async () => {
    (estimateTokens as any).mockReturnValue(10000);
    const result = await compactIfNeeded('s1', 'proj', [], 10000, config(0.5), null);
    expect('restoredFiles' in result).toBe(false);
  });

  it('resets failure count after TTL expires', async () => {
    (findSessionIndex as any).mockReturnValue({ currentTurnId: 0 });

    (estimateTokens as any).mockReturnValue(10000);
    await compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);
    await compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);
    await compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);

    const blocked = await compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);
    expect(blocked.didCompress).toBe(false);

    const originalNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 25 * 60 * 60 * 1000);

    const afterTTL = await compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);
    expect(afterTTL.didCompress).toBe(false);

    vi.restoreAllMocks();
  });
});
