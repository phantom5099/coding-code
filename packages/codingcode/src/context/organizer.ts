import type { ContextConfig } from './config.js';
import type { Message } from '../core/types.js';
import { resolveSessionDir, readHistory, applyVisibilityEvents, findSessionIndex, buildMessagesFromEvents, persistToolResult } from '../session/store.js';
import { estimateMessageTokens, estimateTokensForContent } from './utils/tokens.js';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { SessionEvent, ToolResultEvent, ToolBudgetEvent, SummaryEvent, UserEvent } from '../session/types.js';

export interface BuildResult {
  messages: Message[];
  snipTokensFreed: number;
  newBudgets: ToolBudgetEvent[];
}

export function assemblePayload(
  sessionId: string,
  encodedProjectPath: string,
  config: ContextConfig,
): BuildResult {
  const dir = resolveSessionDir(sessionId);
  if (!dir) throw new Error(`Session ${sessionId} not found`);
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const events = readHistory(jsonlPath);

  const hidden = applyVisibilityEvents(events);
  const visible = events.filter((ev) => {
    if (ev.type === 'hide' || ev.type === 'unhide') return false;
    if ('uuid' in ev && hidden.has((ev as any).uuid)) return false;
    return true;
  }) as SessionEvent[];

  const idx = findSessionIndex(sessionId);
  const currentTurnId = idx?.currentTurnId ?? 0;
  const { events: compacted, snipTokensFreed, newBudgets } = applyLocalCompaction(visible, currentTurnId, config, jsonlPath, sessionId, encodedProjectPath);

  const messages = buildMessagesFromEvents(compacted as any);

  return { messages, snipTokensFreed, newBudgets };
}

function applyLocalCompaction(
  events: SessionEvent[],
  currentTurnId: number,
  config: ContextConfig,
  jsonlPath: string,
  sessionId: string,
  encodedProjectPath: string,
): { events: SessionEvent[]; snipTokensFreed: number; newBudgets: ToolBudgetEvent[] } {
  const budgetResult = applyToolResultBudget(events, config, jsonlPath, sessionId, encodedProjectPath);
  const snipResult = snipEvents(budgetResult.events, config);
  const result = microcompact(snipResult.events, config);
  return { events: result, snipTokensFreed: snipResult.tokensFreed, newBudgets: budgetResult.newBudgets };
}

function toolMsgTokens(output: string, tool: ToolResultEvent): number {
  return estimateMessageTokens({ role: 'tool', content: output, tool_call_id: tool.toolCallId, tool_name: tool.toolName } as any);
}

function applyToolResultBudget(
  events: SessionEvent[],
  config: ContextConfig,
  jsonlPath: string,
  sessionId: string,
  encodedProjectPath: string,
): { events: SessionEvent[]; newBudgets: ToolBudgetEvent[] } {
  const budgetMap = new Map<string, ToolBudgetEvent>();
  for (const ev of events) {
    if (ev.type === 'tool_budget') budgetMap.set(ev.toolCallId, ev);
  }

  const lastUserIdx = [...events].reverse().findIndex(e => e.type === 'user');
  if (lastUserIdx < 0) return { events: replaceBudgeted(events, budgetMap), newBudgets: [] };

  const lastUser = events[events.length - 1 - lastUserIdx] as UserEvent;
  const lastUserTurnId = lastUser.turnId;

  const toolResults = events.filter((e): e is ToolResultEvent => {
    if (e.type !== 'tool_result') return false;
    if (e.turnId !== lastUserTurnId) return false;
    if (budgetMap.has(e.toolCallId)) return false;
    return true;
  });

  if (toolResults.length === 0) return { events: replaceBudgeted(events, budgetMap), newBudgets: [] };

  const totalTokens = toolResults.reduce((sum, t) => sum + toolMsgTokens(t.output, t), 0);

  if (totalTokens <= config.toolResultBudgetThreshold) {
    return { events: replaceBudgeted(events, budgetMap), newBudgets: [] };
  }

  const ranked = [...toolResults].sort((a, b) => {
    return estimateTokensForContent(b.output) - estimateTokensForContent(a.output);
  });

  let remaining = totalTokens;
  const newBudgets: ToolBudgetEvent[] = [];

  for (const tool of ranked) {
    if (remaining <= config.toolResultBudgetThreshold) break;
    const result = persistToolResult(encodedProjectPath, sessionId, tool.toolCallId, tool.output);
    const preview = tool.output.slice(0, config.persistPreviewChars);

    const budgetEvent: ToolBudgetEvent = {
      type: 'tool_budget',
      uuid: randomUUID(),
      toolCallId: tool.toolCallId,
      path: result.path,
      preview,
      bytes: result.bytes,
      timestamp: new Date().toISOString(),
    };
    newBudgets.push(budgetEvent);
    budgetMap.set(tool.toolCallId, budgetEvent);
    const replacementOutput = `[...persisted at: ${result.path} (${result.bytes} bytes)]\n\n${preview}`;
    const saved = toolMsgTokens(tool.output, tool) - toolMsgTokens(replacementOutput, tool);
    remaining -= saved;
  }

  return { events: replaceBudgeted(events, budgetMap), newBudgets };
}

function replaceBudgeted(
  events: SessionEvent[],
  budgetMap: Map<string, ToolBudgetEvent>,
): SessionEvent[] {
  return events
    .filter(e => e.type !== 'tool_budget')
    .map(e => {
      if (e.type === 'tool_result' && budgetMap.has(e.toolCallId)) {
        const b = budgetMap.get(e.toolCallId)!;
        return { ...e, output: `[...persisted at: ${b.path} (${b.bytes} bytes)]\n\n${b.preview}` };
      }
      return e;
    });
}

interface SnipResult {
  events: SessionEvent[];
  tokensFreed: number;
}

export function snipEvents(events: SessionEvent[], config: ContextConfig): SnipResult {
  if (events.length <= config.snipMaxMessages) return { events, tokensFreed: 0 };

  const keepFrom = events.length - config.snipMaxMessages;
  let boundary = keepFrom;
  while (boundary < events.length && events[boundary]?.type !== 'user') {
    boundary++;
  }
  if (boundary >= events.length) return { events, tokensFreed: 0 };

  const snipped = events.slice(0, boundary);
  const snippedTokens = snipped.reduce((sum, e) => {
    if (e.type === 'user') return sum + estimateMessageTokens({ role: 'user', content: e.content });
    if (e.type === 'assistant') return sum + estimateMessageTokens({ role: 'assistant', content: e.content });
    if (e.type === 'tool_result') {
      return sum + estimateMessageTokens({ role: 'tool', content: e.output, tool_call_id: e.toolCallId, tool_name: e.toolName } as any);
    }
    if (e.type === 'summary') {
      return sum + estimateMessageTokens({ role: 'system', name: 'compacted_history', content: e.summaryText });
    }
    return sum;
  }, 0);

  const summary: SummaryEvent = {
    type: 'summary',
    uuid: randomUUID(),
    replaces: snipped.filter(e => 'uuid' in e).map(e => (e as any).uuid),
    summaryText: `[${snipped.length} messages snipped]`,
    method: 'context-collapse',
    timestamp: new Date().toISOString(),
  };

  return { events: [summary, ...events.slice(boundary)], tokensFreed: snippedTokens };
}

export function microcompact(events: SessionEvent[], config: ContextConfig): SessionEvent[] {
  const replacement = '[Old tool result content cleared]';
  const toolResults = events.filter((e): e is ToolResultEvent => {
    if (e.type !== 'tool_result') return false;
    if (config.toolsExemptFromMicrocompact.includes(e.toolName ?? '')) return false;
    if (estimateTokensForContent(e.output ?? '') <= 120) return false;
    return true;
  });

  if (toolResults.length <= config.keepRecentToolResults) return events;

  const recentUuids = new Set(
    toolResults.slice(-config.keepRecentToolResults).map(e => e.uuid)
  );
  const prunedUuids = new Set(
    toolResults.filter(e => !recentUuids.has(e.uuid)).map(e => e.uuid)
  );

  return events.map(e => {
    if (e.type === 'tool_result' && prunedUuids.has(e.uuid)) {
      return { ...e, output: replacement };
    }
    return e;
  });
}

