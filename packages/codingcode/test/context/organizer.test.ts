import { describe, it, expect } from 'vitest';
import { fitToBudget } from '../../src/context/organizer.js';
import type { Message } from '../../src/core/types.js';
import type { ContextConfig } from '../../src/context/config.js';

function msg(content: string, role: Message['role'] = 'user', toolCalls?: Message['tool_calls']): Message {
  return toolCalls ? { role, content, tool_calls: toolCalls } : { role, content };
}

function turn(userContent: string, assistantContent: string, toolContent: string, turnNum: number): Message[] {
  return [
    { role: 'user', content: userContent },
    { role: 'assistant', content: assistantContent, tool_calls: [{ id: `tc${turnNum}`, name: 'test', arguments: {} }] },
    { role: 'tool', content: toolContent, tool_call_id: `tc${turnNum}` },
  ];
}

const testConfig: ContextConfig = {
  defaultMaxTokens: 1000,
  reservedTokens: 100,
  thresholds: { prune: 0.7, compaction: 0.9 },
  pruneProtectedTokens: 40000,
  pruneMinRelease: 20000,
  toolsExemptFromPrune: ['Read'],
  prefixTurnsProtected: 1,
  minTurnsBetweenCompactions: 5,
  keepRecentTurns: 10,
  compactionModel: 'haiku',
  archiveTtlDays: 30,
  checkpointKeep: 50,
  reactiveCompactMaxRetries: 1,
  reactiveCompactKeepTurns: 3,
  snipMaxMessages: 100,
  snipKeepHead: 3,
  microKeepRecentTools: 5,
  persistPreviewChars: 2000,
  thresholdTokens: 2000,
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

  it('removes entire user turn (user+assistant+tool) when trimming', () => {
    // Two complete turns, very large content. Budget = 900.
    // Turn 1: user(457t) + assistant(457t) + tool(457t) = 1371t
    // Turn 2: user(457t) + assistant(457t) + tool(457t) = 1371t
    // Total ≈ 2742t > 900 → should remove entire turn 1 (all 3 messages)
    const messages = [...turn('a'.repeat(1600), 'b'.repeat(1600), 'c'.repeat(1600), 1),
                      ...turn('d'.repeat(1600), 'e'.repeat(1600), 'f'.repeat(1600), 2)];
    const result = fitToBudget(messages, testConfig, 0);
    expect(result.length).toBeLessThanOrEqual(3); // either turn 2 alone or part of it
    expect(result[0]?.role).not.toBe('user'); // turn 1's user should be gone
  });
});
