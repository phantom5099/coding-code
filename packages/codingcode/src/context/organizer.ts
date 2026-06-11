import type { ContextConfig } from './config.js';
import type { Message } from '../core/types.js';
import { findSessionIndex, resolveSessionJsonlPath, readHistory, appendLine } from '../session/io.js';
import { applyVisibilityEvents, buildMessagesFromEvents } from '../session/messages.js';
import { estimateTokens } from './util.js';
import { randomUUID } from 'crypto';
import type { SessionEvent, ToolResultEvent, CompactEvent } from '../session/types.js';

const COMPACTABLE_TOOLS = new Set([
  'read_file',
  'execute_command',
  'search_code',
  'search_files',
  'web_search',
  'fetch_url',
  'write_file',
  'edit_file',
]);

export interface BuildResult {
  messages: Message[];
  compactedEvents: SessionEvent[];
  promptEstimate: number;
  currentTurnId: number;
  compactedTurnIds: Set<number>;
}

export function assemblePayload(
  sessionId: string,
  encodedProjectPath: string,
  config: ContextConfig,
  contextWindow: number = 128000
): BuildResult {
  const jsonlPath = resolveSessionJsonlPath(sessionId);
  let events = readHistory(jsonlPath);

  const idx = findSessionIndex(sessionId);
  const currentTurnId = idx?.currentTurnId ?? 0;

  const { hidden, compactedTurnIds: initialCompactedTurnIds } = applyVisibilityEvents(events);
  let visible = filterVisible(events, hidden);
  let compactedTurnIds = initialCompactedTurnIds;

  const preEstimate = estimateTokensFromEvents(visible);

  const didCompact = applyOldTurnCompaction(
    visible,
    currentTurnId,
    config,
    preEstimate,
    contextWindow,
    jsonlPath
  );

  if (didCompact) {
    events = readHistory(jsonlPath);
    const updated = applyVisibilityEvents(events);
    visible = filterVisible(events, updated.hidden);
    compactedTurnIds = updated.compactedTurnIds;
  }

  const messages = buildMessagesFromEvents(visible);
  return {
    messages,
    compactedEvents: visible,
    promptEstimate: estimateTokens(messages),
    currentTurnId,
    compactedTurnIds,
  };
}

function filterVisible(events: SessionEvent[], hidden: Set<string>): SessionEvent[] {
  return events.filter((ev) => {
    if (ev.type === 'hide' || ev.type === 'unhide') return false;
    if (ev.type === 'compact') return false;
    if ('uuid' in ev && hidden.has((ev as any).uuid)) return false;
    return true;
  }) as SessionEvent[];
}

function applyOldTurnCompaction(
  events: SessionEvent[],
  currentTurnId: number,
  config: ContextConfig,
  promptEstimate: number,
  contextWindow: number,
  jsonlPath: string
): boolean {
  if (promptEstimate <= contextWindow * config.microCompactThreshold) return false;

  const compactedTurnIds = new Set<number>();
  for (const ev of events) {
    if (ev.type === 'compact') {
      for (let t = ev.startTurnId; t <= ev.endTurnId; t++) {
        compactedTurnIds.add(t);
      }
    }
  }

  const oldResults: ToolResultEvent[] = [];
  for (const ev of events) {
    if (ev.type !== 'tool_result') continue;
    if (ev.turnId >= currentTurnId - 1) continue;
    if (compactedTurnIds.has(ev.turnId)) continue;
    if (!COMPACTABLE_TOOLS.has(ev.toolName.toLowerCase())) continue;
    if (ev.output.length <= config.microCompactMinChars) continue;
    oldResults.push(ev);
  }

  if (oldResults.length === 0) return false;

  const turnIds = [...new Set(oldResults.map((ev) => ev.turnId))].sort((a, b) => a - b);
  const startTurnId = turnIds[0]!;
  const endTurnId = turnIds[turnIds.length - 1]!;

  const compactEvent: CompactEvent = {
    type: 'compact',
    uuid: randomUUID(),
    startTurnId,
    endTurnId,
    timestamp: new Date().toISOString(),
  };
  appendLine(jsonlPath, compactEvent);
  return true;
}

function estimateTokensFromEvents(events: SessionEvent[]): number {
  return estimateTokens(buildMessagesFromEvents(events));
}
