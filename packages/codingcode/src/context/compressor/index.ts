import { randomUUID } from 'crypto';
import { loadRawEvents, eventToEnriched } from '../../session/jsonl-reader.js';
import { applyProjections } from '../projection/apply.js';
import { loadProjectionStore, appendProjection } from '../../session/projection-store.js';
import { findSessionIndex } from '../../session/store.js';
import { estimateTokensForContent } from '../utils/tokens.js';
import { resolveCompactionLLM } from './llm-resolver.js';
import type { ContextConfig } from '../config.js';
import type { Message } from '../../core/types.js';
import type { EnrichedMessage, ProjectionEntry } from '../projection/types.js';
import type { SessionEvent } from '../../session/types.js';
import type { LLMClient } from '../../llm/client.js';

export interface CompressResult {
  didCompress: boolean;
  released: number;
}

/**
 * Mutable in-memory view shared across all steps within one `run()` call.
 * Loaded once at run start; mutated locally as each step writes a projection,
 * eliminating the previous "each step reloads from disk" cost.
 */
interface CompressionView {
  raw: SessionEvent[];                  // immutable for this run
  projections: ProjectionEntry[];       // updated as we append
  /** Post-projection view, recomputed lazily when invalidated. */
  projected: EnrichedMessage[];
  /** Set of event uuids covered by *some* projection — used to skip them. */
  covered: Set<string>;
}

interface CompressContext {
  sessionId: string;
  config: ContextConfig;
  llm: LLMClient | null;
  currentTurnId: number;
  view: CompressionView;
}

/**
 * Compress in a single linear pass. Each step is idempotent within one turn —
 * a second iteration would find no new candidates or hit a range-overlap guard.
 */
export async function run(
  sessionId: string,
  usage: number,
  llm: LLMClient | null,
  config: ContextConfig,
): Promise<CompressResult> {
  const idx = findSessionIndex(sessionId);
  const currentTurnId = idx?.currentTurnId ?? 0;
  const view = loadView(sessionId);
  const ctx: CompressContext = { sessionId, config, llm, currentTurnId, view };
  const budget = config.defaultMaxTokens;

  let remaining = usage;

  // Prune (>70% budget)
  if (remaining > budget * config.thresholds.prune) {
    remaining -= tryPruneTools(ctx);
  }

  // L1b Truncate (>60% budget, budgetReduction threshold)
  if (remaining > budget * config.thresholds.budgetReduction) {
    remaining -= tryTruncateTools(ctx);
  }

  // L2 Snip (message count threshold)
  remaining -= trySnip(ctx);

  // L3 Microcompact (tool result count threshold)
  remaining -= tryMicrocompact(ctx);

  // L5 Compaction (>90% budget)
  if (remaining > budget * config.thresholds.compaction) {
    remaining -= await tryL5Compaction(ctx);
  }

  return { didCompress: remaining < usage, released: usage - remaining };
}

export async function compactWithLLM(
  sessionId: string,
  config: ContextConfig,
  llm: LLMClient | null,
): Promise<CompressResult> {
  const idx = findSessionIndex(sessionId);
  const currentTurnId = idx?.currentTurnId ?? 0;
  const view = loadView(sessionId);
  const ctx: CompressContext = { sessionId, config, llm, currentTurnId, view };
  const released = await tryL5Compaction(ctx);
  return { didCompress: released > 0, released };
}

// ---------- View loading ----------

function loadView(sessionId: string): CompressionView {
  const raw = loadRawEvents(sessionId);
  const projections = [...loadProjectionStore(sessionId).projections];
  const projected = computeProjected(raw, projections);
  const covered = computeCovered(projections);
  return { raw, projections, projected, covered };
}

function computeProjected(
  raw: SessionEvent[],
  projections: ProjectionEntry[],
): EnrichedMessage[] {
  const enriched: EnrichedMessage[] = [];
  for (const ev of raw) {
    const e = eventToEnriched(ev);
    if (e) enriched.push(e);
  }
  return applyProjections(enriched, projections);
}

function computeCovered(projections: ProjectionEntry[]): Set<string> {
  const set = new Set<string>();
  for (const p of projections) {
    if (p.type === 'message') set.add(p.targetEventUuid);
    // RangeProjections don't anchor on uuids; raw events whose turn falls
    // inside a range get filtered separately by collectAllRawTools.
  }
  return set;
}

function applyEntryToView(view: CompressionView, entry: ProjectionEntry): void {
  view.projections.push(entry);
  if (entry.type === 'message') {
    view.covered.add(entry.targetEventUuid);
  }
  // Recompute projected view in-memory (no disk hit).
  view.projected = computeProjected(view.raw, view.projections);
}

// ---------- L2 Prune ----------

function tryPruneTools(ctx: CompressContext): number {
  const { sessionId, config, currentTurnId, view } = ctx;
  const candidates = collectPrunableTools(view, config, currentTurnId);
  if (candidates.length === 0) return 0;

  let released = 0;
  for (const tool of candidates) {
    if (released >= config.pruneMinRelease) break;
    const tokenCount = estimateTokensForContent(tool.message.content);
    const entry: ProjectionEntry = {
      type: 'message',
      id: randomUUID(),
      targetEventUuid: tool.uuid,
      replacement: {
        role: 'tool',
        content: '[Old tool result content cleared]',
        tool_call_id: tool.message.tool_call_id ?? '',
      },
      originalTurnId: tool.turnId,
      method: 'prune',
      createdAt: new Date().toISOString(),
    };
    appendProjection(sessionId, entry);
    applyEntryToView(view, entry);
    released += tokenCount - estimateTokensForContent(entry.replacement.content);
  }
  return released;
}

// ---------- L1b Truncate ----------

function tryTruncateTools(ctx: CompressContext): number {
  const { sessionId, config, view } = ctx;
  let released = 0;

  for (const e of view.projected) {
    if (e.message.role !== 'tool') continue;
    if (e.source.kind === 'projection') continue;
    if (estimateTokensForContent(e.message.content) <= config.thresholdTokens) continue;

    const toolName = e.message.tool_name ?? '';
    if (config.persistableTools.includes(toolName)) continue; // L1a handles persist

    const content = e.message.content;
    const lines = content.split('\n');
    const total = lines.length;
    if (total <= config.truncateKeepHeadLines + config.truncateKeepTailLines) continue;

    const head = lines.slice(0, config.truncateKeepHeadLines).join('\n');
    const tail = lines.slice(-config.truncateKeepTailLines).join('\n');
    const omitted = total - config.truncateKeepHeadLines - config.truncateKeepTailLines;
    const hint = buildRecoveryHint(toolName);
    const summary = `${head}\n\n[…${omitted} lines omitted${hint ? '; ' + hint : ''}]\n\n${tail}`;

    const originalTokens = estimateTokensForContent(content);
    const summaryTokens = estimateTokensForContent(summary);
    if (summaryTokens >= originalTokens) continue;

    const entry: ProjectionEntry = {
      type: 'message',
      id: randomUUID(),
      targetEventUuid: e.uuid,
      replacement: { role: 'tool', content: summary, tool_call_id: e.message.tool_call_id ?? '' },
      originalTurnId: e.turnId,
      method: 'collapse-rule',
      createdAt: new Date().toISOString(),
    };
    appendProjection(sessionId, entry);
    applyEntryToView(view, entry);
    released += originalTokens - summaryTokens;
  }

  return released;
}

function buildRecoveryHint(toolName: string): string {
  switch (toolName) {
    case 'Read': return 'use Read with offset/limit to view specific range';
    case 'Grep': return 're-run Grep with refined pattern';
    case 'Glob': return 're-run Glob with narrower pattern';
    default: return '';
  }
}

// ---------- L2 Snip ----------

function trySnip(ctx: CompressContext): number {
  const { sessionId, config, view } = ctx;
  const enriched = view.projected;
  if (enriched.length <= config.snipMaxMessages) return 0;

  const head = enriched.slice(0, config.snipKeepHead);
  const tail = enriched.slice(-(config.snipMaxMessages - config.snipKeepHead));

  const snippedMessages = enriched.slice(head.length, enriched.length - tail.length);
  if (snippedMessages.length === 0) return 0;

  const snippedTokens = snippedMessages.reduce((s, m) => s + estimateTokensForContent(m.message.content), 0);

  const startTurn = head[head.length - 1]?.turnId ?? 0;
  const endTurn = tail[0]?.turnId ?? startTurn;
  const placeholder: Message = {
    role: 'user',
    content: `[${snippedMessages.length} messages snipped from conversation middle]`,
  };
  const entry: ProjectionEntry = {
    type: 'range',
    id: randomUUID(),
    turnRange: [startTurn + 1, endTurn - 1],
    summaryMessages: [placeholder],
    method: 'context-collapse',
    createdAt: new Date().toISOString(),
  };
  appendProjection(sessionId, entry);
  applyEntryToView(view, entry);
  return Math.max(0, snippedTokens - estimateTokensForContent(placeholder.content));
}

// ---------- L3 Microcompact ----------

function tryMicrocompact(ctx: CompressContext): number {
  const { sessionId, config, view } = ctx;
  const toolMessages = view.projected.filter((e) => e.message.role === 'tool' && e.source.kind === 'raw');
  if (toolMessages.length <= config.microKeepRecentTools) return 0;

  let released = 0;
  const recentIds = new Set(toolMessages.slice(-config.microKeepRecentTools).map((e) => e.uuid));
  for (const tool of toolMessages) {
    if (recentIds.has(tool.uuid)) continue;
    if (tool.message.content.length <= 120) continue;
    const originalTokens = estimateTokensForContent(tool.message.content);
    const replacement = '[Earlier tool result compacted. Re-run if needed.]';
    const entry: ProjectionEntry = {
      type: 'message',
      id: randomUUID(),
      targetEventUuid: tool.uuid,
      replacement: { role: 'tool', content: replacement, tool_call_id: tool.message.tool_call_id ?? '' },
      originalTurnId: tool.turnId,
      method: 'prune',
      createdAt: new Date().toISOString(),
    };
    appendProjection(sessionId, entry);
    applyEntryToView(view, entry);
    released += originalTokens - estimateTokensForContent(replacement);
  }
  return released;
}

// ---------- L5 Compaction ----------

async function tryL5Compaction(ctx: CompressContext): Promise<number> {
  const { sessionId, config, currentTurnId, view } = ctx;

  const startTurn = 1;
  const endTurn = currentTurnId - config.keepRecentTurns;
  if (endTurn < startTurn) return 0;
  const turnsInRange = endTurn - startTurn + 1;
  if (turnsInRange < config.minTurnsBetweenCompactions) return 0;

  for (const p of view.projections) {
    if (p.type === 'range' && p.turnRange[0] <= endTurn && p.turnRange[1] >= startTurn) return 0;
  }

  // Use post-projection messages for the LLM transcript: tools that have
  // been pruned/collapsed get sent as their (small) replacement, not their
  // original raw output. This is the key token-saving step.
  const transcript = collectProjectedTranscript(view, startTurn, endTurn);
  if (transcript.length === 0) return 0;

  const summary = await callLLMForCompaction(transcript, ctx.llm, config);
  if (!summary) return 0;

  const summaryMessage: Message = {
    role: 'system',
    name: 'compacted_history',
    content: summary,
  };

  const entry: ProjectionEntry = {
    type: 'range',
    id: randomUUID(),
    turnRange: [startTurn, endTurn],
    summaryMessages: [summaryMessage],
    method: 'auto-compact',
    createdAt: new Date().toISOString(),
  };
  appendProjection(sessionId, entry);
  applyEntryToView(view, entry);

  // Released tokens = projected (pre-summary) tokens in range - summary tokens
  const replacedTokens = transcript.reduce((sum, m) => sum + estimateTokensForContent(m.content), 0);
  const summaryTokens = estimateTokensForContent(summary);
  return Math.max(0, replacedTokens - summaryTokens);
}

function collectProjectedTranscript(
  view: CompressionView,
  startTurn: number,
  endTurn: number,
): Message[] {
  const result: Message[] = [];
  for (const e of view.projected) {
    if (e.turnId < startTurn || e.turnId > endTurn) continue;
    result.push(e.message);
  }
  return result;
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

  const system = `You analyze and then summarize an agent conversation transcript.

Output exactly two top-level blocks:

<analysis>
Free-form notes about the conversation. Identify the user's goal, what was done, what was learned, what remains. This block is for your reasoning — be thorough.
</analysis>

<summary>
## 1. Primary Request and Intent
The user's overall objective and concrete asks.

## 2. Key Technical Concepts
Frameworks, patterns, domain concepts that appeared.

## 3. Files and Code Sections
Files touched or referenced; for each, the relevant function/section.

## 4. Errors and Fixes
Concrete errors encountered and how they were resolved (or not).

## 5. Problem Solving
Non-trivial reasoning chains and the approaches that succeeded.

## 6. All User Messages
Verbatim or near-verbatim list of every user message in chronological order.

## 7. Pending Tasks
Work the user explicitly asked for that is not yet done.

## 8. Current Work
What was happening at the moment of compaction.

## 9. Optional Next Step
A recommended next action consistent with the user's intent.
</summary>`;

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

function collectAllRawTools(view: CompressionView): EnrichedMessage[] {
  return view.projected.filter(
    (e) => e.source.kind === 'raw' && e.message.role === 'tool',
  );
}

function collectPrunableTools(
  view: CompressionView,
  config: ContextConfig,
  currentTurnId: number,
): EnrichedMessage[] {
  const all = collectAllRawTools(view);

  const turnCutoff = currentTurnId - config.prefixTurnsProtected - 1;
  const oldEnough = all.filter((t) => t.turnId <= turnCutoff);

  const whitelisted = oldEnough.filter(
    (t) => !config.toolsExemptFromPrune.includes(t.message.tool_name ?? ''),
  );

  // Token-budget protection: tools whose cumulative tokens (newest first)
  // fit inside `pruneProtectedTokens` are protected; the rest are prunable.
  const sortedByTurn = [...whitelisted].sort((a, b) => b.turnId - a.turnId);
  const prunable: EnrichedMessage[] = [];
  let recentTokenSum = 0;
  for (const tool of sortedByTurn) {
    const t = estimateTokensForContent(tool.message.content);
    if (recentTokenSum < config.pruneProtectedTokens) {
      recentTokenSum += t;
      continue;
    }
    prunable.push(tool);
  }

  return prunable.sort(
    (a, b) => (b.message.content?.length ?? 0) - (a.message.content?.length ?? 0),
  );
}

