import { Layer, Effect } from 'effect';
import { randomUUID } from 'crypto';
import { loadConfig } from '../infra/config.js';
import { transcriptPathOf } from '../session/paths.js';
import type { Message } from '../llm/types.js';
import { textOf, textPart } from '../llm/types.js';
import type {
  SessionEvent,
  AssistantEvent,
  ToolResultEvent,
  CompactEvent,
  SummaryEvent,
} from '../session/types.js';
import type { SessionRef } from '../session/types.js';
import { SessionService } from '../session/port.js';
import { estimateTokens, estimateMessageTokens } from './tokens.js';
import { LLMService } from '../llm/port.js';
import { contextWindowOf } from '../infra/models.js';
import { COMPACTION_SYSTEM_PROMPT } from './compaction-prompt.js';

import { AgentError } from '../util/error.js';
import { ContextService } from './port.js';
import type { CompressResult } from './port.js';
import { EventSinkService } from '../sink/port.js';

export function transcriptPathFor(ref: SessionRef): string {
  return transcriptPathOf(ref.cwd, ref.sessionId, ref.parentSessionId);
}

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

export function passesContextFilter(ev: SessionEvent): boolean {
  return ev.type !== 'session_meta' && ev.type !== 'rollback' && ev.type !== 'compact';
}

export function filterForContext(events: SessionEvent[]): {
  visible: SessionEvent[];
  compactedTurnIds: Set<number>;
} {
  const { hiddenTurnIds, hiddenOpUuids, compactedTurnIds } = applyVisibilityEvents(events);
  const visible = events.filter((ev) => {
    if (!passesContextFilter(ev)) return false;
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
        const msg: Message = { role: 'assistant', content: [textPart(event.content)] };
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
          content: [textPart(output)],
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
        });
        break;
      }
      case 'summary':
        messages.push({
          role: 'system',
          name: 'compacted_history',
          content: [textPart(event.summaryText)],
        });
        break;
      case 'subagent_result':
        messages.push({ role: 'user', content: [textPart(event.content)] });
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
      // parts 数组本身就是分隔符，providers 侧按 part 逐个送出
      prev.content = [...prev.content, ...curr.content];
      filtered.splice(i, 1);
    }
  }

  return filtered;
}

export function estimatePromptTokensFrom(events: SessionEvent[]): number {
  const { visible, compactedTurnIds } = filterForContext(events);
  return estimateTokens(buildContextMessages(visible, compactedTurnIds));
}

interface ContextBuffer {
  turnId: number;
  jsonlPath: string;
  events: SessionEvent[];
  compactedTurnIds: Set<number>;
}

export const ContextLayer = Layer.effect(
  ContextService,
  Effect.gen(function* () {
    const session = yield* SessionService;
    const llm = yield* LLMService;
    const sink = yield* EventSinkService;

    // 回合内内存态：键 = sessionId，仅在换回合（turnId 变化）时重建
    const buffers = new Map<string, ContextBuffer>();

    const buildBuffer = (ref: SessionRef): Effect.Effect<ContextBuffer, AgentError> =>
      Effect.gen(function* () {
        const jsonlPath = transcriptPathFor(ref);
        const events = yield* session.readEvents(jsonlPath); // 唯一读盘点
        const { visible, compactedTurnIds } = filterForContext(events);
        return { turnId: ref.currentTurnId, jsonlPath, events: visible, compactedTurnIds };
      });

    const ensureBuffer = (ref: SessionRef): Effect.Effect<ContextBuffer, AgentError> =>
      Effect.gen(function* () {
        const cached = buffers.get(ref.sessionId);
        if (cached && cached.turnId === ref.currentTurnId) return cached; // 回合内复用
        const buf = yield* buildBuffer(ref);
        buffers.set(ref.sessionId, buf);
        return buf;
      });

    const estimateFor = (buf: ContextBuffer): number =>
      estimateTokens(buildContextMessages(buf.events, buf.compactedTurnIds));

    const applyOldTurnCompact = (buf: ContextBuffer): Effect.Effect<boolean, AgentError> =>
      Effect.gen(function* () {
        const oldResults: ToolResultEvent[] = [];
        for (const ev of buf.events) {
          if (ev.type !== 'tool_result') continue;
          if (ev.turnId >= buf.turnId - 1) continue;
          if (buf.compactedTurnIds.has(ev.turnId)) continue;
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
        yield* session.appendEvent(buf.jsonlPath, compactEvent);
        for (let t = startTurnId; t <= endTurnId; t++) buf.compactedTurnIds.add(t);
        return true;
      });

    const runMicroCompact = (
      buf: ContextBuffer,
      contextWindow: number
    ): Effect.Effect<void, AgentError> =>
      Effect.gen(function* () {
        if (estimateFor(buf) <= contextWindow * MICRO_COMPACT_THRESHOLD) return;
        yield* applyOldTurnCompact(buf);
      });

    const tryCompaction = (buf: ContextBuffer, model: string): Effect.Effect<number, AgentError> =>
      Effect.gen(function* () {
        const endTurn = buf.turnId - KEEP_RECENT_TURNS - 1;
        if (endTurn < 1) return 0;

        const inRange = buf.events.filter((ev) => {
          if (ev.type === 'session_meta') return false;
          if ('turnId' in ev && (ev as any).turnId >= 1 && (ev as any).turnId <= endTurn)
            return true;
          return false;
        });
        if (inRange.length === 0) return 0;

        const targetEvents = getIncrementalEvents(inRange);
        if (targetEvents.length === 0) return 0;

        const msgs = buildContextMessages(targetEvents, buf.compactedTurnIds);
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
        yield* session.appendEvent(buf.jsonlPath, summaryEvent);

        // 就地更新：被摘要的 turn 移出可见集，摘要追加到末尾（与重读盘后的顺序一致）
        buf.events = buf.events.filter(
          (ev) =>
            !(
              'turnId' in ev &&
              (ev as any).turnId >= startTurnId &&
              (ev as any).turnId <= endTurnId
            )
        );
        buf.events.push(summaryEvent);

        const summaryMsg: Message = {
          role: 'system',
          name: 'compacted_history',
          content: [textPart(summary)],
        };
        return Math.max(0, totalTokens - estimateMessageTokens(summaryMsg));
      });

    const needsCompaction = (buf: ContextBuffer, contextWindow: number): boolean =>
      estimateFor(buf) > contextWindow * COMPACTION_THRESHOLD;

    const summarizeToFit = (
      buf: ContextBuffer,
      contextWindow: number,
      model: string
    ): Effect.Effect<void, AgentError> =>
      Effect.gen(function* () {
        for (let i = 0; i < MAX_AUTO_COMPACT_PASSES; i++) {
          if (!needsCompaction(buf, contextWindow)) break;
          const released = yield* tryCompaction(buf, model);
          if (released <= 0) break;
        }
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
              `[${m.role}${(m as any).tool_name ? ':' + (m as any).tool_name : ''}]\n${textOf(m.content)}`
          )
          .join('\n\n');

        const system = COMPACTION_SYSTEM_PROMPT;

        const userMsg: Message = {
          role: 'user',
          content: [
            textPart(
              `Compact the following conversation transcript into the sections above:\n\n${transcriptText}`
            ),
          ],
        };

        const result = yield* llm
          .complete({ messages: [userMsg], system }, model)
          .pipe(Effect.either);
        if (result._tag === 'Left') return null;
        return normalizeSummary(result.right.content);
      }).pipe(Effect.catchAllCause(() => Effect.succeed(null)));

    function normalizeSummary(raw: string): string {
      return raw.trim();
    }

    const getHistory = (ref: SessionRef, model: string): Effect.Effect<Message[], AgentError> =>
      Effect.gen(function* () {
        const buf = yield* ensureBuffer(ref);
        const contextWindow = contextWindowOf(model);
        yield* runMicroCompact(buf, contextWindow);
        if (needsCompaction(buf, contextWindow)) {
          // 压缩判定与压缩帧都归 context，agent 不参与
          yield* sink.emit(ref.sessionId, { family: 'transition', transition: { to: 'compress' } });
          yield* summarizeToFit(buf, contextWindow, model);
          yield* sink.emit(ref.sessionId, {
            family: 'transition',
            transition: { to: 'executing' },
          });
        }
        return buildContextMessages(buf.events, buf.compactedTurnIds);
      });

    const absorb = (ref: SessionRef, events: readonly SessionEvent[]): Effect.Effect<void> =>
      Effect.sync(() => {
        const buf = buffers.get(ref.sessionId);
        // 未建（事件已在盘上，重建时会读到）或已换回合 ⇒ no-op
        if (!buf || buf.turnId !== ref.currentTurnId) return;
        for (const ev of events) if (passesContextFilter(ev)) buf.events.push(ev);
      });

    const compact = (
      ref: SessionRef,
      model: string,
      usage?: number
    ): Effect.Effect<CompressResult, AgentError> =>
      Effect.gen(function* () {
        const buf = yield* ensureBuffer(ref);
        const contextWindow = contextWindowOf(model);
        yield* runMicroCompact(buf, contextWindow);
        const preEstimate = usage ?? estimateFor(buf);
        const released = yield* tryCompaction(buf, model);
        if (released <= 0) {
          return { didCompress: false, released: 0, promptEstimate: preEstimate };
        }
        return { didCompress: true, released, promptEstimate: estimateFor(buf) };
      });

    const dispose = (sessionId: string): Effect.Effect<void> =>
      Effect.sync(() => {
        buffers.delete(sessionId);
      });

    return {
      getHistory,
      absorb,
      compact,
      dispose,
    };
  })
);
