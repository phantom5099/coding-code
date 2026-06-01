import { randomUUID } from 'crypto';
import { readHistory, findSessionIndex } from '../../session/store.js';
import { resolveSessionDir } from '../../session/store.js';
import { estimateTokens, estimateMessageTokens } from '../utils/tokens.js';
import { resolveCompactionLLM } from './llm-resolver.js';
import { COMPACTION_SYSTEM_PROMPT } from './prompt.js';
import type { ContextConfig } from '../config.js';
import type { Message } from '../../core/types.js';
import type { SessionEvent, SummaryEvent } from '../../session/types.js';
import type { LLMClient } from '../../llm/client.js';
import { assemblePayload } from '../organizer.js';
import { join } from 'path';
import { appendFileSync } from 'fs';

export interface CompressResult {
  didCompress: boolean;
  released: number;
  promptEstimate: number;
}

interface CompressContext {
  sessionId: string;
  encodedProjectPath: string;
  config: ContextConfig;
  llm: LLMClient | null;
  currentTurnId: number;
  events: SessionEvent[];
  hiddenUuids: Set<string>;
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
  promptEstimate: number,
  snipTokensFreed: number,
  modelMaxTokens: number,
  config: ContextConfig,
  llm: LLMClient | null,
): Promise<CompressResult> {
  const failures = getFailures(sessionId);
  if (failures >= 3) {
    return { didCompress: false, released: 0, promptEstimate };
  }

  const threshold = modelMaxTokens * config.compactionThreshold;
  const effectiveEstimate = promptEstimate - (snipTokensFreed ?? 0);
  if (effectiveEstimate <= threshold) {
    return { didCompress: false, released: 0, promptEstimate };
  }

  const result = await compactWithLLM(sessionId, encodedProjectPath, config, llm, promptEstimate, modelMaxTokens);

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
  usage?: number,
  modelMaxTokens?: number,
): Promise<CompressResult> {
  const idx = findSessionIndex(sessionId);
  const currentTurnId = idx?.currentTurnId ?? 0;
  const ctx = buildContext(sessionId, encodedProjectPath, config, llm, currentTurnId);

  let released = 0;

  const threshold = modelMaxTokens ? modelMaxTokens * config.compactionThreshold : Infinity;
  if (usage === undefined || usage - released > threshold) {
    released += await tryL5Compaction(ctx);
  }

  const payload = assemblePayload(sessionId, encodedProjectPath, config);
  const promptEstimate = estimateTokens(payload.messages);

  return { didCompress: released > 0, released, promptEstimate };
}

// ---------- Context building ----------

function buildContext(
  sessionId: string,
  encodedProjectPath: string,
  config: ContextConfig,
  llm: LLMClient | null,
  currentTurnId: number,
): CompressContext {
  const dir = resolveSessionDir(sessionId);
  if (!dir) throw new Error(`Session ${sessionId} not found`);
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const events = readHistory(jsonlPath);

  // Compute which event uuids are already hidden by prior summary/hide events
  const { hidden } = buildFilteredView(events);

  return {
    sessionId,
    encodedProjectPath,
    config,
    llm,
    currentTurnId,
    events,
    hiddenUuids: hidden,
  };
}

function buildFilteredView(events: SessionEvent[]): { hidden: Set<string> } {
  const hidden = new Set<string>();
  const hideEffects = new Map<string, Set<string>>();

  for (const ev of events) {
    switch (ev.type) {
      case 'hide': {
        let effect: Set<string>;
        if (ev.kind === 'message') {
          effect = new Set([ev.targetUuid]);
        } else {
          effect = new Set<string>();
          for (const prior of events) {
            if (prior === ev) break;
            if ('turnId' in prior && prior.turnId >= ev.throughTurnId && 'uuid' in prior) {
              effect.add(prior.uuid);
            }
          }
        }
        hideEffects.set(ev.uuid, effect);
        for (const u of effect) hidden.add(u);
        break;
      }
      case 'unhide': {
        const effect = hideEffects.get(ev.targetHideUuid);
        if (effect) for (const u of effect) hidden.delete(u);
        break;
      }
      case 'summary': {
        for (const u of ev.replaces) hidden.add(u);
        break;
      }
    }
  }

  return { hidden };
}

function appendSummaryToSession(sessionId: string, event: SummaryEvent): void {
  const dir = resolveSessionDir(sessionId);
  if (!dir) throw new Error(`Session ${sessionId} not found`);
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  appendFileSync(jsonlPath, JSON.stringify(event) + '\n', 'utf8');
}

// ---------- LLM Compaction ----------

async function tryL5Compaction(ctx: CompressContext): Promise<number> {
  const { sessionId, config, currentTurnId, events, hiddenUuids } = ctx;

  const startTurn = 1;
  const endTurn = currentTurnId - config.keepRecentTurns;
  if (endTurn < startTurn) return 0;
  const turnsInRange = endTurn - startTurn + 1;
  if (turnsInRange < config.minTurnsBetweenCompactions) return 0;

  // Collect visible messages in the range for LLM transcript
  const inRange = events.filter((ev) => {
    if (ev.type === 'session_meta') return false;
    if ('uuid' in ev && hiddenUuids.has((ev as any).uuid)) return false;
    if ('turnId' in ev && (ev as any).turnId >= startTurn && (ev as any).turnId <= endTurn) return true;
    return false;
  });

  if (inRange.length === 0) return 0;

  const transcript: Message[] = [];
  const replacedUuids: string[] = [];
  for (const ev of inRange) {
    if ('uuid' in ev) replacedUuids.push((ev as any).uuid);
    switch (ev.type) {
      case 'user':
        transcript.push({ role: 'user', content: ev.content });
        break;
      case 'assistant':
        transcript.push({ role: 'assistant', content: ev.content });
        break;
      case 'tool_result':
        transcript.push({ role: 'tool', content: ev.output, tool_call_id: ev.toolCallId, tool_name: ev.toolName } as any);
        break;
      case 'summary':
        transcript.push({ role: 'system', name: 'compacted_history', content: ev.summaryText });
        break;
    }
  }

  const summary = await callLLMForCompaction(transcript, ctx.llm, config);
  if (!summary) return 0;

  const event: SummaryEvent = {
    type: 'summary',
    uuid: randomUUID(),
    replaces: replacedUuids,
    summaryText: summary,
    method: 'auto-compact',
    timestamp: new Date().toISOString(),
  };
  appendSummaryToSession(sessionId,event);
  for (const u of replacedUuids) hiddenUuids.add(u);

  const replacedTokens = transcript.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  const summaryMsg: Message = { role: 'system', name: 'compacted_history', content: summary };
  const summaryTokens = estimateMessageTokens(summaryMsg);
  return Math.max(0, replacedTokens - summaryTokens);
}

async function callLLMForCompaction(
  transcript: Message[],
  fallbackLlm: LLMClient | null,
  config: ContextConfig,
): Promise<string | null> {
  const llm = await resolveCompactionLLM(config, fallbackLlm);
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

// ---------- Helpers ----------
