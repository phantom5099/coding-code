import { Layer, Effect } from 'effect';
import { randomUUID } from 'crypto';
import { loadConfig } from '../infra/config.js';
import type { Message } from '../contracts/types.js';
import { SessionService } from '../session/port.js';
import { estimateTokens, estimateMessageTokens } from './tokens.js';
import { LLMService } from '../llm/port.js';
import { contextWindowOf } from '../infra/models.js';
import { COMPACTION_SYSTEM_PROMPT } from './compaction-prompt.js';
import type { SessionEvent, AssistantEvent, ToolResultEvent, CompactEvent, SummaryEvent } from '../contracts/session.js';
import { AgentError } from '../core/error.js';
import { ContextService } from './port.js';
import type { CompressResult } from './port.js';

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

const MICRO_COMPACT_THRESHOLD = 0.25;
const MICRO_COMPACT_MIN_CHARS = 120;
const COMPACTION_THRESHOLD = 0.85;
const KEEP_RECENT_TURNS = 1;
const MAX_AUTO_COMPACT_PASSES = 3;

function applyVisibilityEvents(events: SessionEvent[]): {
  hiddenTurnIds: Set<number>;
  hiddenOpUuids: Set<string>;
  compactedTurnIds: Set<number>;
} {
  const hiddenTurnIds = new Set<number>();
  const hiddenOpUuids = new Set<string>();
  const compactedTurnIds = new Set<number>();

  let minRollbackThrough = Infinity;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === 'rollback') {
      if (ev.throughTurnId < minRollbackThrough) {
        minRollbackThrough = ev.throughTurnId;
      }
      continue;
    }
    if (ev.type === 'summary' || ev.type === 'compact') {
      const op = ev as SummaryEvent | CompactEvent;
      if (minRollbackThrough <= op.endTurnId) {
        hiddenOpUuids.add(op.uuid);
      } else if (ev.type === 'summary') {
        for (let t = op.startTurnId; t <= op.endTurnId; t++) hiddenTurnIds.add(t);
      } else {
        for (let t = op.startTurnId; t <= op.endTurnId; t++) compactedTurnIds.add(t);
      }
      continue;
    }
    if ('turnId' in ev && minRollbackThrough <= (ev as any).turnId) {
      hiddenTurnIds.add((ev as any).turnId);
    }
  }

  return { hiddenTurnIds, hiddenOpUuids, compactedTurnIds };
}

export function filterForContext(events: SessionEvent[]): {
  visible: SessionEvent[];
  compactedTurnIds: Set<number>;
} {
  const { hiddenTurnIds, hiddenOpUuids, compactedTurnIds } = applyVisibilityEvents(events);
  const visible = events.filter((ev) => {
    if (ev.type === 'session_meta') return false;
    if (ev.type === 'rollback') return false;
    if (ev.type === 'compact') return false;
    if (ev.type === 'summary' && hiddenOpUuids.has(ev.uuid)) return false;
    if ('turnId' in ev && hiddenTurnIds.has(ev.turnId)) return false;
    return true;
  }) as SessionEvent[];
  return { visible, compactedTurnIds };
}

export function buildContextMessages(
  events: SessionEvent[],
  compactedTurnIds?: Set<number>
): Message[] {
  const messages: Message[] = [];
  const resolvedIds = new Set<string>();
  for (const event of events) {
    switch (event.type) {
      case 'user':
        messages.push({ role: 'user', content: event.content });
        break;
      case 'assistant': {
        const ev = event as AssistantEvent;
        const msg: Message = { role: 'assistant', content: event.content };
        if (event.toolCalls && event.toolCalls.length > 0) {
          msg.tool_calls = event.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }));
        }
        if (ev.usage) msg.usage = ev.usage;
        messages.push(msg);
        break;
      }
      case 'tool_result': {
        let output = event.output;
        if (
          compactedTurnIds?.has(event.turnId) &&
          COMPACTABLE_TOOLS.has(event.toolName.toLowerCase()) &&
          event.output.length > MICRO_COMPACT_MIN_CHARS
        ) {
          output = `[Earlier: used ${event.toolName}]`;
        }
        resolvedIds.add(event.toolCallId);
        messages.push({
          role: 'tool',
          content: output,
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
        });
        break;
      }
      case 'summary':
        messages.push({ role: 'system', name: 'compacted_history', content: event.summaryText });
        break;
    }
  }

  // tool call pairing validation + filter
  const validAssistantIds = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const tcs = m.tool_calls;
    if (!tcs || tcs.length === 0) continue;
    if (tcs.every((tc) => resolvedIds.has(tc.id))) {
      for (const tc of tcs) validAssistantIds.add(tc.id);
    }
  }

  const filtered = messages.filter((m) => {
    if (m.role === 'assistant') {
      const tcs = m.tool_calls;
      if (!tcs || tcs.length === 0) return true;
      return tcs.every((tc) => resolvedIds.has(tc.id));
    }
    if (m.role === 'tool') {
      return validAssistantIds.has(m.tool_call_id!);
    }
    return true;
  });

  // merge adjacent same-role messages
  for (let i = filtered.length - 1; i > 0; i--) {
    const curr = filtered[i]!;
    const prev = filtered[i - 1]!;
    if (curr.role === prev.role && curr.role !== 'system') {
      if (curr.role === 'tool') continue;
      if (curr.role === 'assistant' && curr.tool_calls && curr.tool_calls.length > 0) continue;
      prev.content += '\n\n' + curr.content;
      filtered.splice(i, 1);
    }
  }

  return filtered;
}

export function estimatePromptTokensFrom(events: SessionEvent[]): number {
  const { visible, compactedTurnIds } = filterForContext(events);
  return estimateTokens(buildContextMessages(visible, compactedTurnIds));
}

interface PayloadState {
  jsonlPath: string;
  currentTurnId: number;
  visible: SessionEvent[];
  compactedTurnIds: Set<number>;
}

export const ContextLayer = Layer.effect(ContextService, Effect.gen(function* () {
    const session = yield* SessionService;
    const llm = yield* LLMService;

    const readState = (transcriptPath: string): Effect.Effect<PayloadState, AgentError> =>
      Effect.gen(function* () {
        const jsonlPath = transcriptPath;
        const events = yield* session.readEvents(jsonlPath);
        let currentTurnId = 0;
        for (const ev of events) {
          if ('turnId' in ev && typeof ev.turnId === 'number' && ev.turnId > currentTurnId) {
            currentTurnId = ev.turnId;
          }
        }
        const { visible, compactedTurnIds } = filterForContext(events);
        return { jsonlPath, currentTurnId, visible, compactedTurnIds };
      });

    const estimateFor = (s: PayloadState): number =>
      estimateTokens(buildContextMessages(s.visible, s.compactedTurnIds));

    const applyOldTurnCompact = (
      events: SessionEvent[],
      currentTurnId: number,
      jsonlPath: string
    ): Effect.Effect<boolean, AgentError> =>
      Effect.gen(function* () {
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
          if (ev.output.length <= MICRO_COMPACT_MIN_CHARS) continue;
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
        };
        yield* session.appendEvent(jsonlPath, compactEvent);
        return true;
      });

    const runMicroCompact = (
      s: PayloadState,
      contextWindow: number
    ): Effect.Effect<PayloadState, AgentError> =>
      Effect.gen(function* () {
        if (estimateFor(s) <= contextWindow * MICRO_COMPACT_THRESHOLD) return s;
        const applied = yield* applyOldTurnCompact(s.visible, s.currentTurnId, s.jsonlPath);
        if (applied) {
          return yield* readState(s.jsonlPath);
        }
        return s;
      });

    const tryCompaction = (
      s: PayloadState,
      model: string
    ): Effect.Effect<number, AgentError> =>
      Effect.gen(function* () {
        const endTurn = s.currentTurnId - KEEP_RECENT_TURNS - 1;
        if (endTurn < 1) return 0;

        const inRange = s.visible.filter((ev) => {
          if (ev.type === 'session_meta') return false;
          if ('turnId' in ev && (ev as any).turnId >= 1 && (ev as any).turnId <= endTurn) return true;
          return false;
        });
        if (inRange.length === 0) return 0;

        const targetEvents = getIncrementalEvents(inRange);
        if (targetEvents.length === 0) return 0;

        const msgs = buildContextMessages(targetEvents, s.compactedTurnIds);
        const totalTokens = estimateTokens(msgs);

        const configured = loadConfig().context.compactionModel?.trim();
        let compactionModel = configured || model;
        if (contextWindowOf(compactionModel) < totalTokens + 25000) {
          compactionModel = model;
        }

        const summary = yield* callLLMForCompaction(msgs, compactionModel);
        if (!summary) return 0;

        const turnIds = targetEvents
          .filter((e) => 'turnId' in e)
          .map((e) => (e as any).turnId as number);
        const startTurnId = Math.min(...turnIds);
        const endTurnId = Math.max(...turnIds);

        const summaryEvent: SummaryEvent = {
          type: 'summary',
          uuid: randomUUID(),
          startTurnId,
          endTurnId,
          summaryText: summary,
        };
        yield* session.appendEvent(s.jsonlPath, summaryEvent);

        const summaryMsg: Message = { role: 'system', name: 'compacted_history', content: summary };
        return Math.max(0, totalTokens - estimateMessageTokens(summaryMsg));
      });

    const needsCompaction = (s: PayloadState, contextWindow: number): boolean =>
      estimateFor(s) > contextWindow * COMPACTION_THRESHOLD;

    const summarizeToFit = (
      s: PayloadState,
      contextWindow: number,
      model: string
    ): Effect.Effect<{ state: PayloadState; released: number }, AgentError> =>
      Effect.gen(function* () {
        let cur = s;
        let releasedTotal = 0;
        for (let i = 0; i < MAX_AUTO_COMPACT_PASSES; i++) {
          if (!needsCompaction(cur, contextWindow)) break;
          const released = yield* tryCompaction(cur, model);
          if (released <= 0) break;
          releasedTotal += released;
          cur = yield* readState(cur.jsonlPath);
        }
        return { state: cur, released: releasedTotal };
      });

    function getIncrementalEvents(inRange: SessionEvent[]): SessionEvent[] {
      const existingSummary = [...inRange]
        .reverse()
        .find((e): e is SummaryEvent => e.type === 'summary');

      if (!existingSummary) return inRange;

      const lastTurn = existingSummary.endTurnId ?? 0;
      return inRange.filter((e) => 'turnId' in e && (e as any).turnId > lastTurn);
    }

    const callLLMForCompaction = (
      transcript: Message[],
      model: string
    ): Effect.Effect<string | null> =>
      Effect.gen(function* () {
        const transcriptText = transcript
          .map(
            (m) =>
              `[${m.role}${(m as any).tool_name ? ':' + (m as any).tool_name : ''}]\n${m.content}`
          )
          .join('\n\n');

        const system = COMPACTION_SYSTEM_PROMPT;

        const userMsg: Message = {
          role: 'user',
          content: `Compact the following conversation transcript into the sections above:\n\n${transcriptText}`,
        };

        const result = yield* llm
          .complete({ messages: [userMsg], system }, model)
          .pipe(Effect.either);
        if (result._tag === 'Left') return null;
        return extractSummary(result.right.content.trim());
      }).pipe(Effect.catchAllCause(() => Effect.succeed(null)));

    function extractSummary(raw: string): string {
      const m = raw.match(/<summary>([\s\S]*?)<\/summary>/);
      return (m?.[1] ?? raw).trim();
    }

    const willCompact = (
      transcriptPath: string,
      model: string
    ): Effect.Effect<boolean, AgentError> =>
      Effect.gen(function* () {
        const contextWindow = contextWindowOf(model);
        const s = yield* runMicroCompact(yield* readState(transcriptPath), contextWindow);
        return needsCompaction(s, contextWindow);
      });

    const assemblePayload = (
      transcriptPath: string,
      model: string
    ): Effect.Effect<Message[], AgentError> =>
      Effect.gen(function* () {
        const contextWindow = contextWindowOf(model);
        let s = yield* readState(transcriptPath);
        s = yield* runMicroCompact(s, contextWindow);
        const { state } = yield* summarizeToFit(s, contextWindow, model);
        return buildContextMessages(state.visible, state.compactedTurnIds);
      });

    const compactWithLLM = (
      transcriptPath: string,
      model: string,
      usage?: number
    ): Effect.Effect<CompressResult, AgentError> =>
      Effect.gen(function* () {
        const contextWindow = contextWindowOf(model);
        let s = yield* runMicroCompact(yield* readState(transcriptPath), contextWindow);
        const preEstimate = usage ?? estimateFor(s);
        const released = yield* tryCompaction(s, model);
        if (released <= 0) {
          return { didCompress: false, released: 0, promptEstimate: preEstimate };
        }
        s = yield* readState(transcriptPath);
        return { didCompress: true, released, promptEstimate: estimateFor(s) };
      });

    return {
      willCompact,
      assemblePayload,
      compactWithLLM,
    };
}));
