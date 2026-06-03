import type { ContextConfig } from './config.js';
import type { Message } from '../core/types.js';
import {
  findSessionIndex,
  resolveSessionDir,
  readHistory,
  persistToolResult,
} from '../session/io.js';
import { applyVisibilityEvents, buildMessagesFromEvents } from '../session/messages.js';
import { estimateMessageTokens, estimateTokens, estimateTokensForContent } from './utils/tokens.js';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type {
  SessionEvent,
  ToolResultEvent,
  ToolBudgetEvent,
  SummaryEvent,
  UserEvent,
} from '../session/types.js';

export interface BuildResult {
  messages: Message[];
  newBudgets: ToolBudgetEvent[];
  promptEstimate: number;
}

export function assemblePayload(
  sessionId: string,
  encodedProjectPath: string,
  config: ContextConfig,
  contextWindow: number = 128000
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
  const { events: compacted, newBudgets } = applyLocalCompaction(
    visible,
    currentTurnId,
    config,
    jsonlPath,
    sessionId,
    encodedProjectPath,
    contextWindow
  );

  const messages = buildMessagesFromEvents(compacted as any);

  return { messages, newBudgets, promptEstimate: estimateTokens(messages) };
}

function applyLocalCompaction(
  events: SessionEvent[],
  currentTurnId: number,
  config: ContextConfig,
  jsonlPath: string,
  sessionId: string,
  encodedProjectPath: string,
  contextWindow: number
): { events: SessionEvent[]; newBudgets: ToolBudgetEvent[] } {
  const budgetResult = applyToolResultBudget(
    events,
    config,
    jsonlPath,
    sessionId,
    encodedProjectPath
  );
  const result = pruneByTokens(budgetResult.events, config, contextWindow);
  return { events: result, newBudgets: budgetResult.newBudgets };
}

function toolMsgTokens(output: string, tool: ToolResultEvent): number {
  return estimateMessageTokens({
    role: 'tool',
    content: output,
    tool_call_id: tool.toolCallId,
    tool_name: tool.toolName,
  } as any);
}

function applyToolResultBudget(
  events: SessionEvent[],
  config: ContextConfig,
  jsonlPath: string,
  sessionId: string,
  encodedProjectPath: string
): { events: SessionEvent[]; newBudgets: ToolBudgetEvent[] } {
  const budgetMap = new Map<string, ToolBudgetEvent>();
  for (const ev of events) {
    if (ev.type === 'tool_budget') budgetMap.set(ev.toolCallId, ev);
  }

  const lastUserIdx = [...events].reverse().findIndex((e) => e.type === 'user');
  if (lastUserIdx < 0) return { events: replaceBudgeted(events, budgetMap), newBudgets: [] };

  const lastUser = events[events.length - 1 - lastUserIdx] as UserEvent;
  const lastUserTurnId = lastUser.turnId;

  const toolResults = events.filter((e): e is ToolResultEvent => {
    if (e.type !== 'tool_result') return false;
    if (e.turnId !== lastUserTurnId) return false;
    if (budgetMap.has(e.toolCallId)) return false;
    return true;
  });

  if (toolResults.length === 0)
    return { events: replaceBudgeted(events, budgetMap), newBudgets: [] };

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
  budgetMap: Map<string, ToolBudgetEvent>
): SessionEvent[] {
  return events
    .filter((e) => e.type !== 'tool_budget')
    .map((e) => {
      if (e.type === 'tool_result' && budgetMap.has(e.toolCallId)) {
        const b = budgetMap.get(e.toolCallId)!;
        return { ...e, output: `[...persisted at: ${b.path} (${b.bytes} bytes)]\n\n${b.preview}` };
      }
      return e;
    });
}

export function pruneByTokens(
  events: SessionEvent[],
  config: ContextConfig,
  contextWindow: number
): SessionEvent[] {
  const threshold = contextWindow * config.tokenPruneThreshold;
  const totalTokens = events.reduce((sum, e) => sum + estimateEventTokens(e), 0);
  if (totalTokens <= threshold) return events;

  const turnIds = [
    ...new Set(
      events
        .filter((e) => e.type === 'user' || e.type === 'assistant' || e.type === 'tool_result')
        .map((e) => e.turnId)
        .filter((t): t is number => t !== undefined)
    ),
  ].sort((a, b) => a - b);

  if (turnIds.length <= config.minTurnsBeforePrune) return events;

  const excessTokens = totalTokens - threshold;
  const maxPrunable = turnIds.length - config.minTurnsBeforePrune;
  const hardLimit = config.tokenPruneTurns + config.tokenPruneMaxExtraTurns;
  const pruneableTurnIds = turnIds.slice(0, Math.min(maxPrunable, hardLimit));

  let pruneCount = config.tokenPruneTurns;
  let cumulativeOriginal = 0;
  let cumulativePlaceholder = 0;

  for (let i = 0; i < pruneableTurnIds.length; i++) {
    const tid = pruneableTurnIds[i];
    let turnToolCount = 0;

    for (const e of events) {
      if (e.type === 'tool_result' && e.turnId === tid) {
        cumulativeOriginal += estimateEventTokens(e);
        turnToolCount++;
      }
    }

    const placeholderMsg: any = {
      role: 'tool',
      content: '[Old tool result content cleared]',
      tool_call_id: 'x',
      tool_name: 'x',
    };
    cumulativePlaceholder += turnToolCount * estimateMessageTokens(placeholderMsg);

    if (i + 1 >= config.tokenPruneTurns) {
      const netReleased = cumulativeOriginal - cumulativePlaceholder;
      if (netReleased / excessTokens >= config.tokenPruneMinReleaseRatio) {
        pruneCount = i + 1;
        break;
      }
      pruneCount = i + 1;
    }
  }

  const actualPruneIds = new Set(pruneableTurnIds.slice(0, pruneCount));
  return events.map((e) => {
    if (e.type === 'tool_result' && actualPruneIds.has(e.turnId)) {
      return { ...e, output: '[Old tool result content cleared]' };
    }
    return e;
  });
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
