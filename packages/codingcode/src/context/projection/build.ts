import type { ContextConfig } from '../config.js';
import type { EnrichedMessage } from './types.js';
import { loadRawEvents, eventToEnriched } from '../../session/jsonl-reader.js';
import { loadProjectionStore } from '../../session/projection-store.js';
import { applyProjections } from './apply.js';
import { estimateTokensForContent } from '../utils/tokens.js';

export function buildMessagesForQuery(sessionId: string, config: ContextConfig): EnrichedMessage[] {
  // 1. Load raw events → EnrichedMessage[]
  const rawEvents = loadRawEvents(sessionId);
  let enriched: EnrichedMessage[] = [];
  for (const ev of rawEvents) {
    const e = eventToEnriched(ev);
    if (e) enriched.push(e);
  }

  // 2. Apply projections
  const { projections } = loadProjectionStore(sessionId);
  enriched = applyProjections(enriched, projections);

  // 3. L1: Budget reduction on raw tool messages
  enriched = applyL1BudgetReduction(enriched, config);

  // 4. L3: Sliding window by turn count
  enriched = applyL3SlidingWindow(enriched, config);

  return enriched;
}

function applyL1BudgetReduction(
  enriched: EnrichedMessage[],
  config: ContextConfig,
): EnrichedMessage[] {
  return enriched.map((e) => {
    if (e.message.role !== 'tool') return e;
    if (e.source.kind === 'projection') return e;
    if (estimateTokensForContent(e.message.content) <= config.budgetReductionMaxTokensPerTool) return e;

    const lines = e.message.content.split('\n');
    if (lines.length <= config.budgetReductionKeepLines) return e;

    const kept = lines.slice(-config.budgetReductionKeepLines);
    return {
      ...e,
      message: {
        ...e.message,
        content: `[…${lines.length - config.budgetReductionKeepLines} lines omitted]\n` + kept.join('\n'),
      },
    };
  });
}

function applyL3SlidingWindow(
  enriched: EnrichedMessage[],
  config: ContextConfig,
): EnrichedMessage[] {
  for (const candidate of config.slidingWindowCandidates) {
    const maxTurns = candidate;
    // Count distinct turns
    const turnSet = new Set<number>();
    for (const e of enriched) turnSet.add(e.turnId);
    if (turnSet.size <= maxTurns) return enriched;

    // Keep the most recent `maxTurns` turns
    const sortedTurns = [...turnSet].sort((a, b) => a - b);
    const keepFrom = sortedTurns[sortedTurns.length - maxTurns]!;
    return enriched.filter((e) => e.turnId >= keepFrom);
  }
  return enriched;
}
