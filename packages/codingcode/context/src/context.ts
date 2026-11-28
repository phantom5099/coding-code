import { Layer, Effect } from 'effect';
import { randomUUID } from 'crypto';
import { loadConfig } from '@codingcode/infra';
import type {
  AssistantMessage,
  Message,
  ResolvedContentPart,
  ResolvedMediaPart,
  ResolvedMessage,
} from '@codingcode/model';
import { LLMService, contextWindowOf, textOf, textPart } from '@codingcode/model';
import {
  SessionService,
  isTurnScopedEvent,
  isUuidScopedEvent,
  type CompactEvent,
  type SessionEvent,
  type SessionKey,
  type SessionRef,
  type SummaryEvent,
  type ToolResultEvent,
} from '@codingcode/session';
import { estimateTokens, estimateMessageTokens } from './tokens.js';
import { COMPACTION_SYSTEM_PROMPT } from './compaction-prompt.js';
import { AgentError } from '@codingcode/util';
import {
  ContextService,
  type CompactRequest,
  type CompressResult,
  type ContextRequest,
} from './port.js';
import { TurnRegistryService } from '@codingcode/turn';

const COMPACTABLE_TOOLS = new Set([
  'read_file',
  'execute_command',
  'search_code',
  'search_files',
  'web_search',
  'fetch_url',
  'write_file',
  'edit_file',
  'todo_write',
  'todo_read',
]);

const MICRO_COMPACT_THRESHOLD = 0.25;
const MICRO_COMPACT_MIN_CHARS = 120;
const COMPACTION_THRESHOLD = 0.85;
const KEEP_RECENT_TURNS = 1;
const MAX_AUTO_COMPACT_PASSES = 3;

interface ContextBudget {
  readonly model: string;
  readonly contextWindow: number;
}

function budgetFor(model: string): ContextBudget {
  return { model, contextWindow: contextWindowOf(model) };
}

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
      if (minRollbackThrough <= ev.endTurnId) {
        hiddenOpUuids.add(ev.uuid);
      } else if (ev.type === 'summary') {
        for (let t = ev.startTurnId; t <= ev.endTurnId; t++) hiddenTurnIds.add(t);
      } else {
        for (let t = ev.startTurnId; t <= ev.endTurnId; t++) compactedTurnIds.add(t);
      }
      continue;
    }
    if (isTurnScopedEvent(ev) && minRollbackThrough <= ev.turnId) {
      hiddenTurnIds.add(ev.turnId);
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
    if (isTurnScopedEvent(ev) && hiddenTurnIds.has(ev.turnId)) return false;
    return true;
  });
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
        const msg: AssistantMessage = {
          role: 'assistant',
          content: [textPart(event.content)],
          reasoning: event.reasoning,
        };
        if (event.toolCalls && event.toolCalls.length > 0) {
          msg.tool_calls = event.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }));
        }
        if (event.usage) msg.usage = event.usage;
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
      case 'subagent_message':
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
      prev.content = [...prev.content, ...curr.content];
      if (curr.role === 'assistant' && prev.role === 'assistant' && curr.reasoning) {
        if (prev.reasoning) {
          prev.reasoning = {
            ...prev.reasoning,
            displayText: `${prev.reasoning.displayText}\n${curr.reasoning.displayText}`,
            ...(prev.reasoning.replayData && curr.reasoning.replayData
              ? {
                  replayData: {
                    kind: 'full_text' as const,
                    value: `${prev.reasoning.replayData.value}\n${curr.reasoning.replayData.value}`,
                  },
                }
              : {}),
          };
        } else {
          prev.reasoning = curr.reasoning;
        }
      }
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
  readonly ref: SessionRef;
  events: SessionEvent[];
  compactedTurnIds: Set<number>;
}

export const ContextLayer = Layer.effect(
  ContextService,
  Effect.gen(function* () {
    const session = yield* SessionService;
    const llm = yield* LLMService;
    const turn = yield* TurnRegistryService;

    const buffers = new Map<string, ContextBuffer>();

    const buildBuffer = (ref: SessionRef): Effect.Effect<ContextBuffer, AgentError> =>
      Effect.gen(function* () {
        const events = yield* session.readEvents(ref);
        const { visible, compactedTurnIds } = filterForContext(events);
        return { ref, events: visible, compactedTurnIds };
      });

    const ensureBuffer = (ref: SessionRef): Effect.Effect<ContextBuffer, AgentError> =>
      Effect.gen(function* () {
        const cached = buffers.get(ref.sessionId);
        if (cached && cached.ref.currentTurnId === ref.currentTurnId) return cached;
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
          if (ev.turnId >= buf.ref.currentTurnId - 1) continue;
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
        yield* session.appendEvent(buf.ref, compactEvent);
        for (let t = startTurnId; t <= endTurnId; t++) buf.compactedTurnIds.add(t);
        return true;
      });

    const runMicroCompact = (
      buf: ContextBuffer,
      budget: ContextBudget
    ): Effect.Effect<void, AgentError> =>
      Effect.gen(function* () {
        if (estimateFor(buf) <= budget.contextWindow * MICRO_COMPACT_THRESHOLD) return;
        yield* applyOldTurnCompact(buf);
      });

    const tryCompaction = (buf: ContextBuffer, model: string): Effect.Effect<number, AgentError> =>
      Effect.gen(function* () {
        const endTurn = buf.ref.currentTurnId - KEEP_RECENT_TURNS - 1;
        if (endTurn < 1) return 0;

        const inRange = buf.events.filter(
          (ev) => isTurnScopedEvent(ev) && ev.turnId >= 1 && ev.turnId <= endTurn
        );
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

        const turnIds = targetEvents.filter(isTurnScopedEvent).map((e) => e.turnId);
        const startTurnId = Math.min(...turnIds);
        const endTurnId = Math.max(...turnIds);

        const summaryEvent: SummaryEvent = {
          type: 'summary',
          uuid: randomUUID(),
          startTurnId,
          endTurnId,
          summaryText: summary,
        };
        yield* session.appendEvent(buf.ref, summaryEvent);

        buf.events = buf.events.filter(
          (ev) => !(isTurnScopedEvent(ev) && ev.turnId >= startTurnId && ev.turnId <= endTurnId)
        );
        buf.events.push(summaryEvent);

        const summaryMsg: Message = {
          role: 'system',
          name: 'compacted_history',
          content: [textPart(summary)],
        };
        return Math.max(0, totalTokens - estimateMessageTokens(summaryMsg));
      });

    const needsCompaction = (buf: ContextBuffer, budget: ContextBudget): boolean =>
      estimateFor(buf) > budget.contextWindow * COMPACTION_THRESHOLD;

    const summarizeToFit = (
      buf: ContextBuffer,
      budget: ContextBudget
    ): Effect.Effect<void, AgentError> =>
      Effect.gen(function* () {
        for (let i = 0; i < MAX_AUTO_COMPACT_PASSES; i++) {
          if (!needsCompaction(buf, budget)) break;
          const released = yield* tryCompaction(buf, budget.model);
          if (released <= 0) break;
        }
      });

    function getIncrementalEvents(inRange: SessionEvent[]): SessionEvent[] {
      const existingSummary = [...inRange]
        .reverse()
        .find((e): e is SummaryEvent => e.type === 'summary');

      if (!existingSummary) return inRange;

      const lastTurn = existingSummary.endTurnId ?? 0;
      return inRange.filter((e) => isTurnScopedEvent(e) && e.turnId > lastTurn);
    }

    const callLLMForCompaction = (
      transcript: Message[],
      model: string
    ): Effect.Effect<string | null> =>
      Effect.gen(function* () {
        const transcriptText = transcript
          .map(
            (m) =>
              `[${m.role}${m.role === 'tool' && m.tool_name ? ':' + m.tool_name : ''}]\n${textOf(m.content)}`
          )
          .join('\n\n');

        const userMsg: ResolvedMessage = {
          role: 'user',
          content: [
            textPart(
              `Compact the following conversation transcript into the sections above:\n\n${transcriptText}`
            ),
          ],
        };

        const result = yield* llm
          .complete({ messages: [userMsg], system: COMPACTION_SYSTEM_PROMPT, model })
          .pipe(Effect.either);
        if (result._tag === 'Left') return null;
        return result.right.content.trim();
      }).pipe(Effect.catchAllCause(() => Effect.succeed(null)));

    const resolveMediaParts = (
      msgs: Message[],
      locator: SessionKey
    ): Effect.Effect<ResolvedMessage[], AgentError> =>
      Effect.gen(function* () {
        const assets = new Set<string>();
        for (const m of msgs) {
          for (const p of m.content) if (p.type === 'media') assets.add(p.asset);
        }
        if (assets.size === 0) return msgs as ResolvedMessage[];

        const resolved = yield* session.resolveAssets(locator.cwd, [...assets]);
        return msgs.map((m): ResolvedMessage => {
          const content = m.content.map((p): ResolvedContentPart => {
            if (p.type === 'text') return p;
            const dataUrl = resolved.get(p.asset);
            if (!dataUrl) return { type: 'text', text: `[media missing: ${p.asset}]` };
            const part: ResolvedMediaPart = { type: 'media', dataUrl, mimeType: p.mimeType };
            if (p.filename) part.filename = p.filename;
            return part;
          });
          return { ...m, content } as ResolvedMessage;
        });
      });

    const getHistory = (req: ContextRequest): Effect.Effect<ResolvedMessage[], AgentError> =>
      Effect.gen(function* () {
        const buf = yield* ensureBuffer(req.session);
        const budget = budgetFor(req.model);
        yield* runMicroCompact(buf, budget);
        if (needsCompaction(buf, budget)) {
          yield* turn.transition(req.session.sessionId, { kind: 'compressing' });
          yield* summarizeToFit(buf, budget);
          yield* turn.transition(req.session.sessionId, { kind: 'running' });
        }
        return yield* resolveMediaParts(
          buildContextMessages(buf.events, buf.compactedTurnIds),
          req.session
        );
      });

    const isBuffered = (buf: ContextBuffer, ev: SessionEvent): boolean => {
      if (!isUuidScopedEvent(ev)) return false;
      return buf.events.some((e) => isUuidScopedEvent(e) && e.uuid === ev.uuid);
    };

    const absorb = (ref: SessionRef, events: readonly SessionEvent[]): Effect.Effect<void> =>
      Effect.sync(() => {
        const buf = buffers.get(ref.sessionId);
        if (!buf || buf.ref.currentTurnId !== ref.currentTurnId) return;
        for (const ev of events) {
          if (!passesContextFilter(ev) || isBuffered(buf, ev)) continue;
          buf.events.push(ev);
        }
      });

    const compact = (req: CompactRequest): Effect.Effect<CompressResult, AgentError> =>
      Effect.gen(function* () {
        const buf = yield* ensureBuffer(req.session);
        const budget = budgetFor(req.model);
        yield* runMicroCompact(buf, budget);
        const preEstimate = req.promptTokens ?? estimateFor(buf);
        const released = yield* tryCompaction(buf, req.model);
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
