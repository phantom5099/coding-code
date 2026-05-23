import type { ContextConfig } from '../config.js';
import type { EnrichedMessage } from './types.js';
import { loadRawEvents, eventToEnriched } from '../../session/jsonl-reader.js';
import { loadProjectionStore } from '../../session/projection-store.js';
import { applyProjections } from './apply.js';
import { estimateTokensForContent } from '../utils/tokens.js';
import { persistToolResult } from '../persist/store.js';

export function buildMessagesForQuery(sessionId: string, config: ContextConfig): EnrichedMessage[] {
  const rawEvents = loadRawEvents(sessionId);
  let enriched: EnrichedMessage[] = [];
  for (const ev of rawEvents) {
    const e = eventToEnriched(ev);
    if (e) enriched.push(e);
  }

  const { projections } = loadProjectionStore(sessionId);
  enriched = applyProjections(enriched, projections);

  enriched = applyL1(enriched, config, sessionId);

  return enriched;
}

function applyL1(
  enriched: EnrichedMessage[],
  config: ContextConfig,
  sessionId: string,
): EnrichedMessage[] {
  return enriched.map((e) => {
    if (e.message.role !== 'tool') return e;
    if (e.source.kind === 'projection') return e;
    if (estimateTokensForContent(e.message.content) <= config.thresholdTokens) return e;

    const toolName = (e.message as any).tool_name ?? '';
    const toolCallId = (e.message as any).tool_call_id ?? '';
    if (!config.persistableTools.includes(toolName)) return e;
    return persistAndShrink(e, sessionId, toolCallId, config);
  });
}

function persistAndShrink(
  e: EnrichedMessage,
  sessionId: string,
  toolCallId: string,
  config: ContextConfig,
): EnrichedMessage {
  const { path } = persistToolResult(sessionId, toolCallId, e.message.content);
  const preview = e.message.content.slice(0, config.persistPreviewChars);
  const content = `${preview}\n\n[…full output persisted at: ${path}. Use Read tool to access if needed.]`;
  return { ...e, message: { ...e.message, content } };
}

