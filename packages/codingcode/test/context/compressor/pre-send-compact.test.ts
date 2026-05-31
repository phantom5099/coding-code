import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/context/compressor/llm-resolver.js', () => ({
  resolveCompactionLLM: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../../../src/context/persist/store.js', () => ({
  persistToolResult: vi.fn(() => ({ path: '/tmp/result.txt', bytes: 100 })),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    appendFileSync: vi.fn(),
  };
});

vi.mock('../../../src/session/store.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    resolveSessionDir: vi.fn(() => '/tmp/sessions'),
    findSessionIndex: vi.fn(() => ({ currentTurnId: 10 })),
    readHistory: vi.fn(() => [
      { type: 'user', content: 'hello', uuid: 'u1', turnId: 1 },
      { type: 'assistant', content: 'hi', uuid: 'a1', turnId: 1 },
      ...Array.from({ length: 60 }, (_, i) => ({
        type: 'tool_result',
        output: 'x'.repeat(5000),
        uuid: `t${i}`,
        turnId: 2 + Math.floor(i / 5),
        toolCallId: `tc${i}`,
        toolName: 'Read',
      })),
    ]),
    buildMessages: vi.fn(() => []),
  };
});

import { preSendCompact } from '../../../src/context/compressor/index.js';

const baseConfig = {
  defaultMaxTokens: 200000,
  thresholds: { prune: 0.7, compaction: 0.9 },
  pruneProtectedTokens: 40000,
  pruneMinRelease: 20000,
  toolsExemptFromPrune: ['Read', 'todo_write', 'todo_read', 'tool_search'],
  prefixTurnsProtected: 1,
  minTurnsBetweenCompactions: 5,
  keepRecentTurns: 3,
  snipMaxMessages: 50,
  snipKeepHead: 5,
  persistPreviewChars: 2000,
  thresholdTokens: 8000,
} as any;

describe('preSendCompact', () => {
  it('runs prune and snip unconditionally and returns released + promptEstimate', async () => {
    const result = await preSendCompact('s1', 'proj', baseConfig);
    expect(typeof result.released).toBe('number');
    expect(typeof result.promptEstimate).toBe('number');
    expect(result.released).toBeGreaterThanOrEqual(0);
    expect(result.promptEstimate).toBeGreaterThanOrEqual(0);
  });
});
