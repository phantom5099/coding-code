import { randomUUID } from 'crypto';
import { readHistory, buildMessagesFromEvents, findSessionIndex } from '../../session/store.js';
import { resolveSessionDir } from '../../session/store.js';
import { estimateTokensForContent } from '../utils/tokens.js';
import { resolveCompactionLLM } from './llm-resolver.js';
import { COMPACTION_SYSTEM_PROMPT } from './prompt.js';
import type { ContextConfig } from '../config.js';
import type { Message } from '../../core/types.js';
import type { SessionEvent, SummaryEvent } from '../../session/types.js';
import type { LLMClient } from '../../llm/client.js';
import { persistToolResult } from '../persist/store.js';
import { join } from 'path';
import { appendFileSync } from 'fs';

export interface CompressResult {
  didCompress: boolean;
  released: number;
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

export async function compactWithLLM(
  sessionId: string,
  encodedProjectPath: string,
  config: ContextConfig,
  llm: LLMClient | null,
): Promise<CompressResult> {
  const idx = findSessionIndex(sessionId);
  const currentTurnId = idx?.currentTurnId ?? 0;
  const ctx = buildContext(sessionId, encodedProjectPath, config, llm, currentTurnId);
  const released = await tryL5Compaction(ctx);
  return { didCompress: released > 0, released };
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

// ---------- L1 Persist ----------

function applyToolResultBudget(ctx: CompressContext): number {
  const { sessionId, encodedProjectPath, config, events, hiddenUuids } = ctx;
  let released = 0;

  for (const ev of events) {
    if (ev.type !== 'tool_result') continue;
    if (hiddenUuids.has(ev.uuid)) continue;
    if (ev.tokenCount <= config.thresholdTokens) continue;

    const { path } = persistToolResult(encodedProjectPath, sessionId, ev.toolCallId, ev.output);
    const preview = ev.output.slice(0, config.persistPreviewChars);
    const replacement = `${preview}\n\n[…full output persisted at: ${path}. Use Read tool to access if needed.]`;

    const summaryEvent: SummaryEvent = {
      type: 'summary',
      uuid: randomUUID(),
      replaces: [ev.uuid],
      summaryText: replacement,
      method: 'collapse-llm',
      timestamp: new Date().toISOString(),
    };
    appendSummaryToSession(sessionId,summaryEvent);
    hiddenUuids.add(ev.uuid);
    released += ev.tokenCount - estimateTokensForContent(replacement);
  }

  return released;
}

// ---------- L2 Prune ----------

function tryPruneTools(ctx: CompressContext): number {
  const { sessionId, config, currentTurnId, events, hiddenUuids } = ctx;
  const candidates = collectPrunableTools(events, hiddenUuids, config, currentTurnId);
  if (candidates.length === 0) return 0;

  let released = 0;
  for (const tool of candidates) {
    if (released >= config.pruneMinRelease) break;
    const tokenCount = estimateTokensForContent(tool.output);
    const replacement = '[Old tool result content cleared]';

    const event: SummaryEvent = {
      type: 'summary',
      uuid: randomUUID(),
      replaces: [tool.uuid],
      summaryText: replacement,
      method: 'prune',
      timestamp: new Date().toISOString(),
    };
    appendSummaryToSession(sessionId,event);
    hiddenUuids.add(tool.uuid);
    released += tokenCount - estimateTokensForContent(replacement);
  }
  return released;
}

// ---------- L2 Snip ----------

function trySnip(ctx: CompressContext): number {
  const { sessionId, config, events, hiddenUuids } = ctx;

  // Build visible non-meta events for snip count
  const visibleEvents = events.filter((ev) => {
    if (ev.type === 'session_meta') return false;
    if ('uuid' in ev && hiddenUuids.has((ev as any).uuid)) return false;
    return true;
  });

  if (visibleEvents.length <= config.snipMaxMessages) return 0;

  const headCount = config.snipKeepHead;
  const tailCount = config.snipMaxMessages - config.snipKeepHead;

  const head = visibleEvents.slice(0, headCount);
  const tail = visibleEvents.slice(-tailCount);

  const snippedEvents = visibleEvents.slice(headCount, visibleEvents.length - tailCount);
  if (snippedEvents.length === 0) return 0;

  const snippedTokens = snippedEvents.reduce((s, ev) => {
    if ('content' in ev && typeof ev.content === 'string') return s + estimateTokensForContent(ev.content);
    if ('output' in ev && typeof (ev as any).output === 'string') return s + estimateTokensForContent((ev as any).output);
    return s;
  }, 0);

  const lastHeadTurn = head.length > 0 && 'turnId' in head[head.length - 1] ? (head[head.length - 1] as any).turnId : 0;
  const firstTailTurn = tail.length > 0 && 'turnId' in tail[0] ? (tail[0] as any).turnId : lastHeadTurn;

  // Collect uuids of snipped events
  const snippedUuids = snippedEvents.filter((e) => 'uuid' in e).map((e) => (e as any).uuid as string);

  const summaryText = `[${snippedEvents.length} messages snipped from conversation middle]`;

  const event: SummaryEvent = {
    type: 'summary',
    uuid: randomUUID(),
    replaces: snippedUuids,
    summaryText,
    method: 'context-collapse',
    timestamp: new Date().toISOString(),
  };
  appendSummaryToSession(sessionId,event);
  for (const u of snippedUuids) hiddenUuids.add(u);
  return Math.max(0, snippedTokens - estimateTokensForContent(summaryText));
}

// ---------- L3 Microcompact ----------

function tryMicrocompact(ctx: CompressContext): number {
  const { sessionId, config, events, hiddenUuids } = ctx;
  const toolResults = events.filter((ev) => ev.type === 'tool_result' && !hiddenUuids.has(ev.uuid)) as Extract<SessionEvent, { type: 'tool_result' }>[];
  if (toolResults.length <= config.microKeepRecentTools) return 0;

  let released = 0;
  const recentIds = new Set(toolResults.slice(-config.microKeepRecentTools).map((e) => e.uuid));
  for (const tool of toolResults) {
    if (recentIds.has(tool.uuid)) continue;
    if (tool.output.length <= 120) continue;
    const originalTokens = tool.tokenCount;
    const replacement = '[Earlier tool result compacted. Re-run if needed.]';

    const event: SummaryEvent = {
      type: 'summary',
      uuid: randomUUID(),
      replaces: [tool.uuid],
      summaryText: replacement,
      method: 'prune',
      timestamp: new Date().toISOString(),
    };
    appendSummaryToSession(sessionId,event);
    hiddenUuids.add(tool.uuid);
    released += originalTokens - estimateTokensForContent(replacement);
  }
  return released;
}

// ---------- L5 Compaction ----------

async function tryL5Compaction(ctx: CompressContext): Promise<number> {
  const { sessionId, config, currentTurnId, events, hiddenUuids } = ctx;

  const startTurn = 1;
  const endTurn = currentTurnId - config.keepRecentTurns;
  if (endTurn < startTurn) return 0;
  const turnsInRange = endTurn - startTurn + 1;
  if (turnsInRange < config.minTurnsBetweenCompactions) return 0;

  // Check if there's already a summary covering this range
  for (const ev of events) {
    if (ev.type !== 'summary') continue;
    // Simple check: if any summary event replaces events in this range, skip
    // (Exact range overlap check would require knowing turnIds of replaced events)
  }

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

  const replacedTokens = transcript.reduce((sum, m) => sum + estimateTokensForContent(m.content), 0);
  const summaryTokens = estimateTokensForContent(summary);
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

function collectPrunableTools(
  events: SessionEvent[],
  hiddenUuids: Set<string>,
  config: ContextConfig,
  currentTurnId: number,
): Extract<SessionEvent, { type: 'tool_result' }>[] {
  const all = events.filter(
    (ev): ev is Extract<SessionEvent, { type: 'tool_result' }> =>
      ev.type === 'tool_result' && !hiddenUuids.has(ev.uuid),
  );

  const turnCutoff = currentTurnId - config.prefixTurnsProtected - 1;
  const oldEnough = all.filter((t) => t.turnId <= turnCutoff);

  const whitelisted = oldEnough.filter(
    (t) => !config.toolsExemptFromPrune.includes(t.toolName ?? ''),
  );

  const sortedByTurn = [...whitelisted].sort((a, b) => b.turnId - a.turnId);
  const prunable: typeof all = [];
  let recentTokenSum = 0;
  for (const tool of sortedByTurn) {
    const t = tool.tokenCount;
    if (recentTokenSum < config.pruneProtectedTokens) {
      recentTokenSum += t;
      continue;
    }
    prunable.push(tool);
  }

  return prunable.sort(
    (a, b) => (b.output?.length ?? 0) - (a.output?.length ?? 0),
  );
}
