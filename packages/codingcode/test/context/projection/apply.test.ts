import { describe, it, expect } from 'vitest';
import { applyProjections } from '../../../src/context/projection/apply.js';
import type { EnrichedMessage, ProjectionEntry } from '../../../src/context/projection/types.js';

function makeEnriched(overrides: Partial<EnrichedMessage> & { turnId: number; uuid: string }): EnrichedMessage {
  return {
    message: { role: 'user', content: `msg-${overrides.uuid}` },
    source: { kind: 'raw', eventUuid: overrides.uuid },
    ...overrides,
  };
}

describe('applyProjections', () => {
  it('replaces a range with summary messages', () => {
    const events: EnrichedMessage[] = [
      makeEnriched({ turnId: 1, uuid: 'a' }),
      makeEnriched({ turnId: 2, uuid: 'b' }),
      makeEnriched({ turnId: 3, uuid: 'c' }),
    ];
    const projections: ProjectionEntry[] = [{
      type: 'range',
      id: 'r1',
      turnRange: [1, 2],
      summaryMessages: [{ role: 'system', content: 'summary', name: 'compacted_history' }],
      method: 'auto-compact',
      createdAt: '2024-01-01',
    }];

    const result = applyProjections(events, projections);
    expect(result).toHaveLength(2);
    expect(result[0]!.message.role).toBe('system');
    expect(result[0]!.message.content).toBe('summary');
    expect(result[0]!.source).toEqual({ kind: 'projection', projectionId: 'r1' });
    expect(result[1]!.uuid).toBe('c');
  });

  it('replaces a single message via uuid', () => {
    const events: EnrichedMessage[] = [
      makeEnriched({ turnId: 1, uuid: 'a' }),
      makeEnriched({ turnId: 2, uuid: 'b', message: { role: 'tool', content: 'long output' } }),
    ];
    const projections: ProjectionEntry[] = [{
      type: 'message',
      id: 'm1',
      targetEventUuid: 'b',
      replacement: { role: 'tool', content: '[cleared]' },
      originalTurnId: 2,
      method: 'prune',
      createdAt: '2024-01-01',
    }];

    const result = applyProjections(events, projections);
    expect(result).toHaveLength(2);
    expect(result[1]!.message.content).toBe('[cleared]');
    expect(result[1]!.source.kind).toBe('projection');
  });

  it('applies Range before Message projections', () => {
    const events: EnrichedMessage[] = [
      makeEnriched({ turnId: 1, uuid: 'a' }),
      makeEnriched({ turnId: 2, uuid: 'b', message: { role: 'tool', content: 'tool-b' } }),
      makeEnriched({ turnId: 3, uuid: 'c' }),
    ];
    const projections: ProjectionEntry[] = [
      {
        type: 'range',
        id: 'r1',
        turnRange: [1, 2],
        summaryMessages: [{ role: 'system', content: 'summary' }],
        method: 'auto-compact',
        createdAt: '2024-01-01',
      },
      {
        type: 'message',
        id: 'm1',
        targetEventUuid: 'c',
        replacement: { role: 'user', content: 'replaced-c' },
        originalTurnId: 3,
        method: 'prune',
        createdAt: '2024-01-01',
      },
    ];

    const result = applyProjections(events, projections);
    expect(result).toHaveLength(2);
    expect(result[0]!.message.content).toBe('summary');
    expect(result[1]!.message.content).toBe('replaced-c');
  });

  it('does nothing for empty projections', () => {
    const events: EnrichedMessage[] = [
      makeEnriched({ turnId: 1, uuid: 'a' }),
    ];
    const result = applyProjections(events, []);
    expect(result).toEqual(events);
  });

  it('ignores projection targeting non-existent uuid', () => {
    const events: EnrichedMessage[] = [
      makeEnriched({ turnId: 1, uuid: 'a' }),
    ];
    const projections: ProjectionEntry[] = [{
      type: 'message',
      id: 'm1',
      targetEventUuid: 'nonexistent',
      replacement: { role: 'user', content: 'x' },
      originalTurnId: 99,
      method: 'prune',
      createdAt: '2024-01-01',
    }];
    const result = applyProjections(events, projections);
    expect(result).toHaveLength(1);
    expect(result[0]!.uuid).toBe('a');
  });
});
