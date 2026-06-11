import { randomUUID } from 'crypto';
import { resolveSessionJsonlPath, appendLine } from '../session/io.js';
import {
  estimateTokens,
  estimateMessageTokens,
} from './util.js';
import { buildMessagesFromEvents } from '../session/messages.js';
import { resolveLLM } from '../llm/llm-resolver.js';
import { COMPACTION_SYSTEM_PROMPT } from './compaction-prompt.js';
import type { ContextConfig } from './config.js';
import type { Message } from '../core/types.js';
import type { SessionEvent, SummaryEvent } from '../session/types.js';
import type { LLMClient } from '../llm/client.js';
import { assemblePayload } from './organizer.js';

export interface CompressResult {
  didCompress: boolean;
  released: number;
  promptEstimate: number;
}

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

export async function compactIfNeeded(
  sessionId: string,
  encodedProjectPath: string,
  messages: Message[],
  modelMaxTokens: number,
  config: ContextConfig,
  llm: LLMClient | null,
  compactedEvents?: SessionEvent[],
  currentTurnId?: number
): Promise<CompressResult> {
  const promptEstimate = estimateTokens(messages);
  const failures = getFailures(sessionId);
  if (failures >= 3) {
    return { didCompress: false, released: 0, promptEstimate };
  }

  const threshold = modelMaxTokens * config.compactionThreshold;
  if (promptEstimate <= threshold) {
    return { didCompress: false, released: 0, promptEstimate };
  }

  const result = await compactWithLLM(
    sessionId,
    encodedProjectPath,
    config,
    llm,
    compactedEvents,
    currentTurnId,
    promptEstimate,
    modelMaxTokens
  );

  if (result.didCompress) {
    compactFailureTracker.set(sessionId, { count: 0, lastAttempt: Date.now() });
  } else {
    compactFailureTracker.set(sessionId, { count: failures + 1, lastAttempt: Date.now() });
  }

  return result;
}

export async function compactWithLLM(
  sessionId: string,
  encodedProjectPath: string,
  config: ContextConfig,
  llm: LLMClient | null,
  compactedEvents?: SessionEvent[],
  currentTurnId?: number,
  usage?: number,
  modelMaxTokens?: number
): Promise<CompressResult> {
  const payload = assemblePayload(sessionId, encodedProjectPath, config, modelMaxTokens);
  if (!compactedEvents || currentTurnId === undefined) {
    compactedEvents = payload.compactedEvents;
    currentTurnId = payload.currentTurnId;
  }

  let released = 0;

  const threshold = modelMaxTokens ? modelMaxTokens * config.compactionThreshold : Infinity;
  if (usage === undefined || usage - released > threshold) {
    released += await tryCompaction(sessionId, config, llm, compactedEvents, currentTurnId, payload.compactedTurnIds);
  }

  const postPayload = assemblePayload(sessionId, encodedProjectPath, config, modelMaxTokens);
  return {
    didCompress: released > 0,
    released,
    promptEstimate: estimateTokens(postPayload.messages),
  };
}


// ---------- LLM Compaction ----------

async function tryCompaction(
  sessionId: string,
  config: ContextConfig,
  llm: LLMClient | null,
  compactedEvents: SessionEvent[],
  currentTurnId: number,
  compactedTurnIds: Set<number>,
): Promise<number> {
  const endTurn = currentTurnId - config.keepRecentTurns - 1;
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

  let compactionLlm = await resolveLLM(config.compactionModel, llm);
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
  const llm = await resolveLLM(config.compactionModel, fallbackLlm);
  if (!llm) return null;

  const transcriptText = transcript
    .map((m) => `[${m.role}${(m as any).tool_name ? ':' + (m as any).tool_name : ''}]\n${m.content}`)
    .join('\n\n');

  const system = COMPACTION_SYSTEM_PROMPT;

  const userMsg: Message = {
    role: 'user',
    content: `Compact the following conversation transcript into the sections above:\n\n${transcriptText}`,
  };

  try {
    const result = await llm.complete({ messages: [userMsg], system });
    if (!result.ok) return null;
    return extractSummary(result.value.content.trim());
  } catch {
    return null;
  }
}

function extractSummary(raw: string): string {
  const m = raw.match(/<summary>([\s\S]*?)<\/summary>/);
  return (m?.[1] ?? raw).trim();
}
