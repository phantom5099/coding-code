import type { EnrichedMessage, ProjectionEntry } from './types.js';
import type { Message } from '../../core/types.js';

export function applyProjections(
  enriched: EnrichedMessage[],
  projections: ProjectionEntry[],
): EnrichedMessage[] {
  if (projections.length === 0) return enriched;

  const sorted = [...projections].sort((a, b) => {
    const aStart = a.type === 'range' ? a.turnRange[0] : a.originalTurnId;
    const bStart = b.type === 'range' ? b.turnRange[0] : b.originalTurnId;
    return aStart - bStart;
  });

  let result = [...enriched];

  // Step 1: apply all RangeProjections (oldest to newest)
  for (const proj of sorted) {
    if (proj.type !== 'range') continue;
    const [start, end] = proj.turnRange;
    const startIdx = result.findIndex((m) => m.turnId === start);
    let endIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i]!.turnId === end) { endIdx = i; break; }
    }
    if (startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx) {
      const summaryEnriched: EnrichedMessage[] = proj.summaryMessages.map((msg, i) => ({
        message: msg,
        turnId: start,
        uuid: `proj:${proj.id}:${i}`,
        source: { kind: 'projection' as const, projectionId: proj.id },
      }));
      result.splice(startIdx, endIdx - startIdx + 1, ...summaryEnriched);
    }
  }

  // Step 2: apply all MessageProjections
  for (const proj of sorted) {
    if (proj.type !== 'message') continue;
    const idx = result.findIndex((m) => m.uuid === proj.targetEventUuid);
    if (idx !== -1) {
      result[idx] = {
        ...result[idx]!,
        message: proj.replacement,
        source: { kind: 'projection', projectionId: proj.id },
      };
    }
  }

  return result;
}
