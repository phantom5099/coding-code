import { loadRawEvents, eventToEnriched } from '../../session/jsonl-reader.js';
import { applyProjections } from '../projection/apply.js';
import { loadProjectionStore } from '../../session/projection-store.js';
import { estimateTokensForContent } from '../utils/tokens.js';
import type { ContextConfig } from '../config.js';
import type { Message, ToolCall } from '../../core/types.js';
import { appendProjection, computeRanges } from '../../session/projection-store.js';
import { randomUUID } from 'crypto';

export interface CompressResult {
  didCompress: boolean;
  released: number;
}

interface CompressContext {
  sessionId: string;
  usage: number;
  config: ContextConfig;
  llm: any;
}

export function runL5(
  sessionId: string,
  config: ContextConfig,
  _llm?: any,
): CompressResult {
  // For now, L5 is a no-op stub. Full implementation with LLM summary generation
  // will be added later when the LLM integration path is fully wired.
  return { didCompress: false, released: 0 };
}

export function run(
  sessionId: string,
  usage: number,
  llm: any,
  config: ContextConfig,
): CompressResult {
  const ctx: CompressContext = { sessionId, usage, config, llm };
  let remaining = usage;
  let failures = 0;

  while (remaining > config.defaultMaxTokens * config.thresholds.budgetReduction) {
    const result = tryNextStep(ctx, remaining, failures);
    if (!result) break;
    if (result.released <= 0) {
      failures++;
      if (failures >= config.compactionFuseMaxFailures) break;
    }
    remaining -= result.released;
  }

  return { didCompress: remaining < usage, released: usage - remaining };
}

function tryNextStep(
  ctx: CompressContext,
  remaining: number,
  _failures: number,
): CompressResult | null {
  const rawEvents = loadRawEvents(ctx.sessionId);
  const { projections } = loadProjectionStore(ctx.sessionId);
  const enriched = rawEvents.map((ev) => eventToEnriched(ev)).filter(Boolean) as any;
  const projected = applyProjections(enriched, projections);

  // Collect raw (un-projected) tool messages
  const rawTools = projected.filter((e: any) => e.source?.kind === 'raw' && e.message.role === 'tool') as any[];

  if (rawTools.length === 0) return null;

  const thresholdPrune = ctx.config.defaultMaxTokens * ctx.config.thresholds.prune;
  const thresholdCollapse = ctx.config.defaultMaxTokens * ctx.config.thresholds.collapse;

  if (remaining > thresholdPrune) {
    // Try L2: Prune old tools
    return tryL2Prune(ctx.sessionId, rawTools, ctx.config);
  }

  if (remaining > thresholdCollapse) {
    // Try L4: Collapse old tools (rule-based)
    return tryL4Collapse(ctx.sessionId, rawTools, ctx.config);
  }

  // L5: Compaction
  return runL5(ctx.sessionId, ctx.config, ctx.llm);
}

function tryL2Prune(
  sessionId: string,
  rawTools: any[],
  config: ContextConfig,
): CompressResult {
  const projectedIds = new Set(
    loadProjectionStore(sessionId).projections
      .filter((p) => p.type === 'message')
      .map((p) => p.targetEventUuid),
  );

  const candidates = rawTools
    .filter((t: any) => !projectedIds.has(t.uuid))
    .filter((t: any) => !config.toolsExemptFromPrune.includes(t.message.tool_name))
    .sort((a: any, b: any) => (b.message.content?.length ?? 0) - (a.message.content?.length ?? 0));

  let released = 0;
  let added = 0;

  for (const tool of candidates) {
    if (released >= config.pruneMinRelease) break;
    const tokenCount = estimateTokensForContent(tool.message.content);
    appendProjection(sessionId, {
      type: 'message',
      id: randomUUID(),
      targetEventUuid: tool.uuid,
      replacement: {
        role: 'tool',
        content: '[Old tool result content cleared]',
        tool_call_id: tool.message.tool_call_id,
      },
      originalTurnId: tool.turnId,
      method: 'prune',
      createdAt: new Date().toISOString(),
    });
    released += tokenCount;
    added++;
  }

  return { didCompress: added > 0, released };
}

function tryL4Collapse(
  sessionId: string,
  rawTools: any[],
  config: ContextConfig,
): CompressResult {
  const projectedIds = new Set(
    loadProjectionStore(sessionId).projections
      .filter((p: any) => p.type === 'message')
      .map((p: any) => p.targetEventUuid),
  );

  const candidates = rawTools
    .filter((t: any) => !projectedIds.has(t.uuid))
    .filter((t: any) => estimateTokensForContent(t.message.content) >= config.collapseMinTokens);

  if (candidates.length === 0) return { didCompress: false, released: 0 };

  let released = 0;
  for (const tool of candidates) {
    const content = tool.message.content;
    const lines = content.split('\n');
    const head = lines.slice(0, 10).join('\n');
    const tail = lines.slice(-5).join('\n');
    const summary = `[Collapsed tool: ${tool.message.tool_name} turn ${tool.turnId}]\nPaths: ...\n---\n${head.slice(0, 300)}…${tail.slice(0, 200)}`;

    appendProjection(sessionId, {
      type: 'message',
      id: randomUUID(),
      targetEventUuid: tool.uuid,
      replacement: {
        role: 'tool',
        content: summary.slice(0, config.collapseSummaryMaxTokens * 4),
        tool_call_id: tool.message.tool_call_id,
      },
      originalTurnId: tool.turnId,
      method: 'collapse-rule',
      createdAt: new Date().toISOString(),
    });
    released += estimateTokensForContent(content) - estimateTokensForContent(summary);
  }

  return { didCompress: released > 0, released };
}
