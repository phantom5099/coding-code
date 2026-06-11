import { randomUUID } from 'crypto';
import { resolveSessionDir } from '../session/io.js';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateTokensForContent,
} from './util.js';
import { applyVisibilityEvents } from '../session/messages.js';
import { resolveLLM } from '../llm/llm-resolver.js';
import { COMPACTION_SYSTEM_PROMPT } from './compaction-prompt.js';
import type { ContextConfig } from './config.js';
import type { Message } from '../core/types.js';
import type { SessionEvent, SummaryEvent } from '../session/types.js';
import type { LLMClient } from '../llm/client.js';
import { assemblePayload } from './organizer.js';
import { join } from 'path';
import { appendFileSync } from 'fs';

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
  if (!compactedEvents || currentTurnId === undefined) {
    const payload = assemblePayload(sessionId, encodedProjectPath, config, modelMaxTokens);
    compactedEvents = payload.compactedEvents;
    currentTurnId = payload.currentTurnId;
  }

  let released = 0;

  const threshold = modelMaxTokens ? modelMaxTokens * config.compactionThreshold : Infinity;
  if (usage === undefined || usage - released > threshold) {
    released += await tryCompaction(sessionId, config, llm, compactedEvents, currentTurnId);
  }

  const payload = assemblePayload(sessionId, encodedProjectPath, config, modelMaxTokens);
  return {
    didCompress: released > 0,
    released,
    promptEstimate: estimateTokens(payload.messages),
  };
}

// ---------- Summary persistence ----------

function appendSummaryToSession(sessionId: string, event: SummaryEvent): void {
  const dir = resolveSessionDir(sessionId);
  if (!dir) throw new Error(`Session ${sessionId} not found`);
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  appendFileSync(jsonlPath, JSON.stringify(event) + '\n', 'utf8');
}

// ---------- LLM Compaction ----------

const ESTIMATED_SUMMARY_TOKENS = 5000;
const MAX_TOOL_RESULT_TOKENS = 30000;

async function tryCompaction(
  sessionId: string,
  config: ContextConfig,
  llm: LLMClient | null,
  compactedEvents: SessionEvent[],
  currentTurnId: number
): Promise<number> {
  const endTurn = currentTurnId - config.keepRecentTurns - 1;
  if (endTurn < 1) return 0;

  const { hidden } = applyVisibilityEvents(compactedEvents);

  const inRange = compactedEvents.filter((ev) => {
    if (ev.type === 'session_meta') return false;
    if ('uuid' in ev && hidden.has((ev as any).uuid)) return false;
    if ('turnId' in ev && (ev as any).turnId >= 1 && (ev as any).turnId <= endTurn) return true;
    return false;
  });
  if (inRange.length === 0) return 0;

  const targetEvents = getIncrementalEvents(inRange);
  if (targetEvents.length === 0) return 0;

  const totalTokens = targetEvents.reduce((sum, e) => sum + estimateEventTokens(e), 0);

  let compactionLlm = await resolveLLM(config.compactionModel, llm);
  if (compactionLlm && compactionLlm.modelInfo.maxTokens < totalTokens + 25000) {
    compactionLlm = llm;
  }

  const transcript = buildTranscript(targetEvents);
  const summary = await callLLMForCompaction(transcript, compactionLlm, config);
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
  appendSummaryToSession(sessionId, event);
  for (const u of replacedUuids) hidden.add(u);

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

function buildTranscript(events: SessionEvent[]): Message[] {
  const transcript: Message[] = [];
  for (const ev of events) {
    switch (ev.type) {
      case 'user':
        transcript.push({ role: 'user', content: ev.content });
        break;
      case 'assistant':
        transcript.push({ role: 'assistant', content: ev.content });
        break;
      case 'tool_result': {
        let content = ev.output;
        const tokens = estimateTokensForContent(content);
        if (tokens > MAX_TOOL_RESULT_TOKENS) {
          const ratio = MAX_TOOL_RESULT_TOKENS / tokens;
          const keepChars = Math.floor(content.length * ratio);
          content =
            content.slice(0, keepChars) +
            `\n\n[...truncated: ${tokens} tokens total, showing first ${MAX_TOOL_RESULT_TOKENS}]`;
        }
        transcript.push({
          role: 'tool',
          content,
          tool_call_id: ev.toolCallId,
          tool_name: ev.toolName,
        } as any);
        break;
      }
      case 'summary':
        transcript.push({ role: 'system', name: 'compacted_history', content: ev.summaryText });
        break;
    }
  }
  return transcript;
}

function estimateEventTokens(e: SessionEvent): number {
  if (e.type === 'user') return estimateMessageTokens({ role: 'user', content: e.content });
  if (e.type === 'assistant')
    return estimateMessageTokens({ role: 'assistant', content: e.content });
  if (e.type === 'tool_result') {
    return estimateMessageTokens({
      role: 'tool',
      content: e.output,
      tool_call_id: e.toolCallId,
      tool_name: e.toolName,
    } as any);
  }
  if (e.type === 'summary') {
    return estimateMessageTokens({
      role: 'system',
      name: 'compacted_history',
      content: e.summaryText,
    });
  }
  return 0;
}

async function callLLMForCompaction(
  transcript: Message[],
  fallbackLlm: LLMClient | null,
  config: ContextConfig
): Promise<string | null> {
  const llm = await resolveLLM(config.compactionModel, fallbackLlm);
  if (!llm) return null;

  const transcriptText = transcript
    .map((m) => `[${m.role}${m.tool_name ? ':' + m.tool_name : ''}]\n${m.content}`)
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
