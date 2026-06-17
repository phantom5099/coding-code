import { Effect } from 'effect';
import { randomUUID } from 'crypto';
import type { ContextConfig } from '@codingcode/infra/config';
import type { Message } from '../core/types.js';
import { SessionService } from '../session/store.js';
import { applyVisibilityEvents, buildMessagesFromEvents } from '../session/messages.js';
import { estimateTokens, estimateMessageTokens } from '../core/util.js';
import { resolveSessionJsonlPath, appendLine } from '../session/file-ops.js';
import { resolveLLM } from '../llm/llm-resolver.js';
import { LLMFactoryService } from '../llm/factory.js';
import { COMPACTION_SYSTEM_PROMPT } from './compaction-prompt.js';
import type {
  SessionEvent,
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
const COMPACTION_THRESHOLD = 0.9;
const KEEP_RECENT_TURNS = 1;
const REACTIVE_COMPACT_MAX_RETRIES = 3;

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
      const jsonlPath = resolveSessionJsonlPath(sessionId);
      let events = session.readHistoryFile(jsonlPath);

      const idx = session.findSessionIndexProxy(sessionId);
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
        events = session.readHistoryFile(jsonlPath);
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
    };

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
        timestamp: new Date().toISOString(),
      };
      appendLine(jsonlPath, compactEvent);
      return true;
    }

    function estimateTokensFromEvents(events: SessionEvent[]): number {
      return estimateTokens(buildMessagesFromEvents(events));
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

      const msgs = buildMessagesFromEvents(targetEvents, compactedTurnIds);
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

      const replacedUuids: string[] = [];
      for (const ev of targetEvents) {
        if ('uuid' in (ev as any)) replacedUuids.push((ev as any).uuid);
      }

      const lastTurnId = Math.max(
        ...targetEvents.filter((e) => 'turnId' in e).map((e) => (e as any).turnId),
        0
      );

      const event: SummaryEvent = {
        type: 'summary',
        uuid: randomUUID(),
        replaces: replacedUuids,
        summaryText: summary,
        lastSummarizedTurnId: lastTurnId,
        timestamp: new Date().toISOString(),
      };
      appendLine(resolveSessionJsonlPath(sessionId), event);

      const summaryMsg: Message = { role: 'system', name: 'compacted_history', content: summary };
      return Math.max(0, totalTokens - estimateMessageTokens(summaryMsg));
    }

    function getIncrementalEvents(inRange: SessionEvent[]): SessionEvent[] {
      const existingSummary = [...inRange]
        .reverse()
        .find((e): e is SummaryEvent => e.type === 'summary');

      if (!existingSummary) return inRange;

      const lastTurn = existingSummary.lastSummarizedTurnId ?? 0;
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
