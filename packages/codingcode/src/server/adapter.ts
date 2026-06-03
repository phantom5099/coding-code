import type { AgentEvent } from '../agent/agent.js';

export type SseEvent = Record<string, unknown>;

export function agentEventToSseEvent(event: AgentEvent): SseEvent | null {
  switch (event._tag) {
    case 'Step':
      return { type: 'step', step: event.step };
    case 'TurnId':
      return { type: 'turn_id', turnId: event.turnId };
    case 'ToolStart':
      return { type: 'tool_start', id: event.id, name: event.name, args: event.args };
    case 'ApprovalRequest':
      return { type: 'approval_request', id: event.id, tool: event.tool, args: event.args };
    case 'ToolResult':
      return {
        type: 'tool_result',
        id: event.id,
        name: event.name,
        output: event.output,
        ok: event.ok,
      };
    case 'ToolDenied':
      return { type: 'tool_denied', id: event.id, name: event.name, reason: event.reason };
    case 'Error':
      return { type: 'error', message: event.error.message ?? String(event.error) };
    case 'Done':
      return { type: 'done' };
    case 'TodoUpdate':
      return { type: 'todo_update', items: event.items as unknown as Record<string, unknown>[] };
    case 'Usage':
      return {
        type: 'usage',
        prompt: event.prompt,
        completion: event.completion,
        total: event.total,
      };
    case 'LlmChunk':
    case 'Assistant':
    case 'ReactiveCompact':
      return null;
    default:
      return null;
  }
}

export async function* toSseEvents(
  source: AsyncGenerator<AgentEvent, any, unknown>
): AsyncGenerator<SseEvent, void, unknown> {
  let currentStep = 0;
  for await (const event of source) {
    if (event._tag === 'Step') {
      currentStep = event.step;
      yield { type: 'step', step: event.step };
      continue;
    }
    if (event._tag === 'TurnId') {
      yield { type: 'turn_id', turnId: event.turnId };
      continue;
    }
    if (event._tag === 'LlmChunk') {
      yield { type: 'text', text: event.text, messageId: currentStep };
      continue;
    }
    if (event._tag === 'Assistant') {
      yield { type: 'message', id: currentStep, content: event.content, partial: false };
      continue;
    }
    const sse = agentEventToSseEvent(event);
    if (sse !== null) yield sse;
  }
}
