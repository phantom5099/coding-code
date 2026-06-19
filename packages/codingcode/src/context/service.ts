import { Effect } from 'effect';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { loadConfig } from '@codingcode/infra/config';
import type { Message } from '../core/types.js';
import { SessionService } from '../session/store.js';
import { estimateTokens, estimateMessageTokens } from '../core/util.js';
import { projectSessionsDir, appendLine, readHistory } from '../session/file-ops.js';
import { resolveLLM } from '../llm/llm-resolver.js';
import { LLMFactoryService } from '../llm/factory.js';
import { COMPACTION_SYSTEM_PROMPT } from './compaction-prompt.js';
import type {
  SessionEvent,
  AssistantEvent,
  ToolResultEvent,
  CompactEvent,
  SummaryEvent,
} from '../session/types.js';
import type { LLMClient } from '../llm/client.js';
import type { BuildResult, CompressResult } from './types.js';

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

// --- Internal: visibility computation for LLM context ---

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

/** Filter events for LLM context building: hide summary-covered turns, apply rollback */
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

/** Format filtered events as LLM messages, with micro-compaction for compacted turns */
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

/** Estimate prompt tokens for a session's jsonl file */
export function estimatePromptTokens(jsonlPath: string): number {
  const events = readHistory(jsonlPath);
  const { visible, compactedTurnIds } = filterForContext(events);
  return estimateTokens(buildContextMessages(visible, compactedTurnIds));
}

export class ContextService extends Effect.Service<ContextService>()('Context', {
  effect: Effect.gen(function* () {
    const session = yield* SessionService;
    const factory = yield* LLMFactoryService;
    const assemblePayload = (
      sessionId: string,
      encodedProjectPath: string,
      contextWindow: number
    ): BuildResult => {
      const jsonlPath = join(projectSessionsDir(encodedProjectPath), `${sessionId}.jsonl`);
      let events = session.readHistoryFile(jsonlPath);

      let currentTurnId = 0;
      const idxPath = join(projectSessionsDir(encodedProjectPath), `${sessionId}.index.json`);
      if (existsSync(idxPath)) {
        try {
          const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
          currentTurnId = idx?.currentTurnId ?? 0;
        } catch {}
      }

      let { visible, compactedTurnIds } = filterForContext(events);

      const preEstimate = estimateTokens(buildContextMessages(visible, compactedTurnIds));

      const didCompact = applyOldTurnCompaction(
        visible,
        currentTurnId,
        preEstimate,
        contextWindow,
        jsonlPath
      );

      if (didCompact) {
        events = session.readHistoryFile(jsonlPath);
        ({ visible, compactedTurnIds } = filterForContext(events));
      }

      const messages = buildContextMessages(visible, compactedTurnIds);
      return {
        messages,
        compactedEvents: visible,
        promptEstimate: estimateTokens(messages),
        currentTurnId,
        compactedTurnIds,
      };
    };

    function applyOldTurnCompaction(
      events: SessionEvent[],
      currentTurnId: number,
      promptEstimate: number,
      contextWindow: number,
      jsonlPath: string
    ): boolean {
      if (promptEstimate <= contextWindow * MICRO_COMPACT_THRESHOLD) return false;

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
      appendLine(jsonlPath, compactEvent);
      return true;
    }

    const compactIfNeeded = async (
      sessionId: string,
      encodedProjectPath: string,
      messages: Message[],
      modelMaxTokens: number,
      llm: LLMClient | null
    ): Promise<CompressResult> => {
      const promptEstimate = estimateTokens(messages);
      const threshold = modelMaxTokens * COMPACTION_THRESHOLD;
      if (promptEstimate <= threshold) {
        return { didCompress: false, released: 0, promptEstimate };
      }

      const result = await compactWithLLM(
        sessionId,
        encodedProjectPath,
        modelMaxTokens,
        llm,
        promptEstimate
      );

      return result;
    };

    const compactWithLLM = async (
      sessionId: string,
      encodedProjectPath: string,
      modelMaxTokens: number,
      llm: LLMClient | null,
      usage?: number
    ): Promise<CompressResult> => {
      let released = 0;
      let preEstimate = usage;

      const threshold = modelMaxTokens * COMPACTION_THRESHOLD;
      if (usage === undefined || usage - released > threshold) {
        const { compactedEvents, currentTurnId, compactedTurnIds, promptEstimate } =
          assemblePayload(sessionId, encodedProjectPath, modelMaxTokens);
        preEstimate = promptEstimate;
        released += await tryCompaction(
          sessionId,
          encodedProjectPath,
          llm,
          compactedEvents,
          currentTurnId,
          compactedTurnIds
        );
      }

      if (released <= 0) {
        return {
          didCompress: false,
          released: 0,
          promptEstimate: preEstimate ?? 0,
        };
      }

      const postPayload = assemblePayload(sessionId, encodedProjectPath, modelMaxTokens);
      return {
        didCompress: true,
        released,
        promptEstimate: estimateTokens(postPayload.messages),
        messages: postPayload.messages,
      };
    };

    async function tryCompaction(
      sessionId: string,
      encodedProjectPath: string,
      llm: LLMClient | null,
      compactedEvents: SessionEvent[],
      currentTurnId: number,
      compactedTurnIds: Set<number>
    ): Promise<number> {
      const endTurn = currentTurnId - KEEP_RECENT_TURNS - 1;
      if (endTurn < 1) return 0;

      const inRange = compactedEvents.filter((ev) => {
        if (ev.type === 'session_meta') return false;
        if ('turnId' in ev && (ev as any).turnId >= 1 && (ev as any).turnId <= endTurn) return true;
        return false;
      });
      if (inRange.length === 0) return 0;

      const targetEvents = getIncrementalEvents(inRange);
      if (targetEvents.length === 0) return 0;

      const msgs = buildContextMessages(targetEvents, compactedTurnIds);
      const totalTokens = estimateTokens(msgs);

      let compactionLlm = await Effect.runPromise(
        resolveLLM(loadConfig().context.compactionModel, llm).pipe(
          Effect.provideService(LLMFactoryService, factory)
        )
      );
      if (compactionLlm && compactionLlm.modelInfo.maxTokens < totalTokens + 25000) {
        compactionLlm = llm;
      }

      const summary = await callLLMForCompaction(msgs, compactionLlm);
      if (!summary) return 0;

      const turnIds = targetEvents
        .filter((e) => 'turnId' in e)
        .map((e) => (e as any).turnId as number);
      const startTurnId = Math.min(...turnIds);
      const endTurnId = Math.max(...turnIds);

      const state = await Effect.runPromise(session.load(encodedProjectPath, sessionId));
      await Effect.runPromise(session.appendSummary(state, summary, startTurnId, endTurnId));

      const summaryMsg: Message = { role: 'system', name: 'compacted_history', content: summary };
      return Math.max(0, totalTokens - estimateMessageTokens(summaryMsg));
    }

    function getIncrementalEvents(inRange: SessionEvent[]): SessionEvent[] {
      const existingSummary = [...inRange]
        .reverse()
        .find((e): e is SummaryEvent => e.type === 'summary');

      if (!existingSummary) return inRange;

      const lastTurn = existingSummary.endTurnId ?? 0;
      return inRange.filter((e) => 'turnId' in e && (e as any).turnId > lastTurn);
    }

    async function callLLMForCompaction(
      transcript: Message[],
      fallbackLlm: LLMClient | null
    ): Promise<string | null> {
      const llm = await Effect.runPromise(
        resolveLLM(loadConfig().context.compactionModel, fallbackLlm).pipe(
          Effect.provideService(LLMFactoryService, factory)
        )
      );
      if (!llm) return null;

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

      try {
        const result = await Effect.runPromise(
          llm.complete({ messages: [userMsg], system }).pipe(Effect.either)
        );
        if (result._tag === 'Left') return null;
        return extractSummary(result.right.content.trim());
      } catch {
        return null;
      }
    }

    function extractSummary(raw: string): string {
      const m = raw.match(/<summary>([\s\S]*?)<\/summary>/);
      return (m?.[1] ?? raw).trim();
    }

    return {
      assemblePayload,
      compactIfNeeded,
      compactWithLLM,
    };
  }),
}) {}
