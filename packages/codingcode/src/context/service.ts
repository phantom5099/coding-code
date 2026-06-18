import { Effect } from 'effect';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import type { ContextConfig } from '@codingcode/infra/config';
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
  TokenUsage,
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
const COMPACTION_THRESHOLD = 0.9;
const KEEP_RECENT_TURNS = 1;
const REACTIVE_COMPACT_MAX_RETRIES = 3;

// --- Internal: visibility computation for LLM context ---

function applyVisibilityEvents(events: SessionEvent[]): {
  hiddenTurnIds: Set<number>;
  hiddenOpUuids: Set<string>;
  compactedTurnIds: Set<number>;
} {
  const hiddenTurnIds = new Set<number>();
  const hiddenOpUuids = new Set<string>();
  const compactedTurnIds = new Set<number>();

  for (const ev of events) {
    if (ev.type !== 'rollback') continue;
    for (const prior of events) {
      if (prior === ev) break;
      if (prior.type === 'summary' || prior.type === 'compact') {
        if (prior.endTurnId >= ev.throughTurnId) {
          hiddenOpUuids.add(prior.uuid);
        }
      }
    }
  }

  for (const ev of events) {
    switch (ev.type) {
      case 'rollback': {
        for (const prior of events) {
          if (prior === ev) break;
          if ('turnId' in prior && prior.turnId >= ev.throughTurnId) {
            hiddenTurnIds.add(prior.turnId);
          }
        }
        break;
      }
      case 'summary': {
        if (hiddenOpUuids.has(ev.uuid)) break;
        for (let t = ev.startTurnId; t <= ev.endTurnId; t++) {
          hiddenTurnIds.add(t);
        }
        break;
      }
      case 'compact': {
        if (hiddenOpUuids.has(ev.uuid)) break;
        for (let t = ev.startTurnId; t <= ev.endTurnId; t++) {
          compactedTurnIds.add(t);
        }
        break;
      }
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
          (msg as any).tool_calls = event.toolCalls.map((tc: any) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }));
        }
        if (ev.usage) (msg as any).usage = ev.usage;
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
        } as any);
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
    const tcs = (m as any).tool_calls as Array<{ id: string }> | undefined;
    if (!tcs || tcs.length === 0) continue;
    if (tcs.every((tc) => resolvedIds.has(tc.id))) {
      for (const tc of tcs) validAssistantIds.add(tc.id);
    }
  }

  const filtered = messages.filter((m) => {
    if (m.role === 'assistant') {
      const tcs = (m as any).tool_calls as Array<{ id: string }> | undefined;
      if (!tcs || tcs.length === 0) return true;
      return tcs.every((tc) => resolvedIds.has(tc.id));
    }
    if (m.role === 'tool') {
      return validAssistantIds.has((m as any).tool_call_id);
    }
    return true;
  });

  // merge adjacent same-role messages
  for (let i = filtered.length - 1; i > 0; i--) {
    const curr = filtered[i]!;
    const prev = filtered[i - 1]!;
    if (curr.role === prev.role && curr.role !== 'system') {
      if (curr.role === 'tool') continue;
      if (curr.role === 'assistant' && (curr as any).tool_calls?.length > 0) continue;
      prev.content += '\n\n' + curr.content;
      filtered.splice(i, 1);
    }
  }

  return filtered;
}

/** Find the last visible assistant usage for token estimation */
export function findLastVisibleAssistantUsage(path: string): TokenUsage | undefined {
  const events = readHistory(path);
  const { visible, compactedTurnIds } = filterForContext(events);
  const messages = buildContextMessages(visible, compactedTurnIds);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const usage = (m as any).usage as TokenUsage | undefined;
    if (usage) return usage;
  }
  return undefined;
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
    const compactFailureTracker = new Map<string, { count: number; lastAttempt: number }>();
    const FAILURE_TTL_MS = 24 * 60 * 60 * 1000;

    function getFailures(sessionId: string): number {
      const entry = compactFailureTracker.get(sessionId);
      if (!entry) return 0;
      if (Date.now() - entry.lastAttempt > FAILURE_TTL_MS) {
        compactFailureTracker.delete(sessionId);
        return 0;
      }
      return entry.count;
    }

    const assemblePayload = (
      sessionId: string,
      encodedProjectPath: string,
      config: ContextConfig,
      contextWindow: number = 128000
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
        config,
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
      config: ContextConfig,
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
      config: ContextConfig,
      llm: LLMClient | null
    ): Promise<CompressResult> => {
      const promptEstimate = estimateTokens(messages);
      const failures = getFailures(sessionId);
      if (failures >= 3) {
        return { didCompress: false, released: 0, promptEstimate };
      }

      const threshold = modelMaxTokens * COMPACTION_THRESHOLD;
      if (promptEstimate <= threshold) {
        return { didCompress: false, released: 0, promptEstimate };
      }

      const result = await compactWithLLM(
        sessionId,
        encodedProjectPath,
        messages,
        config,
        llm,
        promptEstimate,
        modelMaxTokens
      );

      if (result.didCompress) {
        compactFailureTracker.set(sessionId, { count: 0, lastAttempt: Date.now() });
      } else {
        compactFailureTracker.set(sessionId, { count: failures + 1, lastAttempt: Date.now() });
      }

      return result;
    };

    const compactWithLLM = async (
      sessionId: string,
      encodedProjectPath: string,
      messages: Message[],
      config: ContextConfig,
      llm: LLMClient | null,
      usage?: number,
      modelMaxTokens?: number
    ): Promise<CompressResult> => {
      let released = 0;

      const threshold = modelMaxTokens ? modelMaxTokens * COMPACTION_THRESHOLD : Infinity;
      if (usage === undefined || usage - released > threshold) {
        const { compactedEvents, currentTurnId, compactedTurnIds } = assemblePayload(
          sessionId,
          encodedProjectPath,
          config,
          modelMaxTokens
        );
        released += await tryCompaction(
          sessionId,
          encodedProjectPath,
          config,
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
          promptEstimate: usage ?? estimateTokens(messages),
        };
      }

      const postPayload = assemblePayload(sessionId, encodedProjectPath, config, modelMaxTokens);
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
      config: ContextConfig,
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
        resolveLLM(config.compactionModel, llm).pipe(
          Effect.provideService(LLMFactoryService, factory)
        )
      );
      if (compactionLlm && compactionLlm.modelInfo.maxTokens < totalTokens + 25000) {
        compactionLlm = llm;
      }

      const summary = await callLLMForCompaction(msgs, compactionLlm, config);
      if (!summary) return 0;

      const turnIds = targetEvents
        .filter((e) => 'turnId' in e)
        .map((e) => (e as any).turnId as number);
      const startTurnId = Math.min(...turnIds);
      const endTurnId = Math.max(...turnIds);

      const event: SummaryEvent = {
        type: 'summary',
        uuid: randomUUID(),
        startTurnId,
        endTurnId,
        summaryText: summary,
      };
      appendLine(join(projectSessionsDir(encodedProjectPath), `${sessionId}.jsonl`), event);

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
      fallbackLlm: LLMClient | null,
      config: ContextConfig
    ): Promise<string | null> {
      const llm = await Effect.runPromise(
        resolveLLM(config.compactionModel, fallbackLlm).pipe(
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
