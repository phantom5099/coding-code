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
 * Compress in a single linear pass. Each level is idempotent within one turn:
 *   - L2 processes ALL prunable tools up to pruneMinRelease in one go.
 *   - L4 collapses ALL eligible tools in one go.
 *   - L5 covers turn range [1, currentTurnId - L5KeepRecentTurns] in one LLM call.
 * A second iteration would either find no new candidates (L2/L4) or hit the
 * range-overlap guard (L5), so we don't loop.
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
  if (remaining > budget * config.thresholds.prune) {
    remaining -= tryL2Prune(ctx);
  }
  if (remaining > budget * config.thresholds.collapse) {
    remaining -= tryL4Collapse(ctx);
  }
  if (remaining > budget * config.thresholds.compaction) {
    remaining -= await tryL5Compaction(ctx);
  }

  return { didCompress: remaining < usage, released: usage - remaining };
}

export async function runL5(
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

function tryL2Prune(ctx: CompressContext): number {
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

// ---------- L4 Collapse ----------

function tryL4Collapse(ctx: CompressContext): number {
  const { sessionId, config, currentTurnId, view } = ctx;
  const candidates = collectCollapsibleTools(view, config, currentTurnId);
  if (candidates.length === 0) return 0;

  let released = 0;
  for (const tool of candidates) {
    const original = tool.message.content;
    const summary = buildRuleSummary(tool, config);
    if (estimateTokensForContent(summary) >= estimateTokensForContent(original)) continue;

    const entry: ProjectionEntry = {
      type: 'message',
      id: randomUUID(),
      targetEventUuid: tool.uuid,
      replacement: {
        role: 'tool',
        content: summary,
        tool_call_id: tool.message.tool_call_id ?? '',
      },
      originalTurnId: tool.turnId,
      method: 'collapse-rule',
      createdAt: new Date().toISOString(),
    };
    appendProjection(sessionId, entry);
    applyEntryToView(view, entry);
    released += estimateTokensForContent(original) - estimateTokensForContent(summary);
  }
  return released;
}

function buildRuleSummary(tool: EnrichedMessage, config: ContextConfig): string {
  const content = tool.message.content;
  const lines = content.split('\n');
  const head = lines.slice(0, 10).join('\n');
  const tail = lines.length > 15 ? lines.slice(-5).join('\n') : '';
  const toolName = tool.message.tool_name ?? 'tool';
  const summary = `[Collapsed tool: ${toolName} turn ${tool.turnId}]\n---\n${head}${tail ? '\n…\n' + tail : ''}`;
  const maxChars = config.collapseSummaryMaxTokens * 4;
  return summary.length > maxChars ? summary.slice(0, maxChars) + '…' : summary;
}

// ---------- L5 Compaction ----------

async function tryL5Compaction(ctx: CompressContext): Promise<number> {
  const { sessionId, config, currentTurnId, view } = ctx;

  const startTurn = 1;
  const endTurn = currentTurnId - config.L5KeepRecentTurns;
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

  const system = `You produce a compressed summary of an agent conversation. Output exactly the following five Markdown sections, each with concise bullet points or short prose. Do not output anything outside these sections.

## Compacted History

### Goal
The user's overall objective.

### Instructions
Specific user-given constraints, preferences, conventions to follow.

### Discoveries
Concrete findings, errors, facts learned during the conversation.

### Accomplished
What has actually been completed (files modified, problems fixed).

### Relevant Files
Path list of files touched or referenced; one per line.`;

  const userMsg: Message = {
    role: 'user',
    content: `Compact the following conversation transcript into the five sections above:\n\n${transcriptText}`,
  };

  try {
    const result = await llm.complete({ messages: [userMsg], system });
    if (!result.ok) return null;
    return result.value.content.trim();
  } catch {
    return null;
  }
}

// ---------- Candidate selection (operates on the shared view) ----------

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

function collectCollapsibleTools(
  view: CompressionView,
  config: ContextConfig,
  currentTurnId: number,
): EnrichedMessage[] {
  const all = collectAllRawTools(view);
  const turnCutoff = currentTurnId - config.prefixTurnsProtected - 1;
  return all.filter((t) => {
    if (t.turnId > turnCutoff) return false;
    if (estimateTokensForContent(t.message.content) < config.collapseMinTokens) return false;
    return true;
  });
}
