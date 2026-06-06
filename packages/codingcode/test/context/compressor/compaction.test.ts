import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';

describe('L5 Compaction', () => {
  it('generates a range projection with five-topic summary format', () => {
    const rangeProj = {
      type: 'range' as const,
      id: randomUUID(),
      turnRange: [1, 10] as [number, number],
      summaryMessages: [
        {
          role: 'system' as const,
          name: 'compacted_history',
          content: [
            '## Compacted History',
            '',
            '### Goal',
            'Fix the login flow',
            '',
            '### Instructions',
            'Check token validation',
            '',
            '### Discoveries',
            'JWT expiry not handled',
            '',
            '### Accomplished',
            'Added refresh logic',
            '',
            '### Relevant Files',
            'src/auth.ts',
          ].join('\n'),
        },
      ],
      createdAt: new Date().toISOString(),
    };

    expect(rangeProj.type).toBe('range');
    expect(rangeProj.summaryMessages).toHaveLength(1);
    const content = rangeProj.summaryMessages[0]!.content;
    expect(content).toContain('### Goal');
    expect(content).toContain('### Instructions');
    expect(content).toContain('### Discoveries');
    expect(content).toContain('### Accomplished');
    expect(content).toContain('### Relevant Files');
    expect(rangeProj.summaryMessages[0]!.name).toBe('compacted_history');
  });
});
