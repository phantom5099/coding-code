import type { AgentEvent } from '../agent/agent.js';

export function formatEventForTransport(event: AgentEvent): string | null {
  switch (event._tag) {
    case 'LlmChunk':
      return event.text;
    case 'ToolStart':
      return `\n[Using: ${event.name}]\n`;
    case 'ToolDenied':
      return `\n[Denied: ${event.name}] ${event.reason}\n`;
    case 'ApprovalRequest':
      return `\n[Approval: ${event.id}] ${event.tool}\n`;
    case 'Step':
    case 'Assistant':
    case 'ToolResult':
    case 'Error':
    case 'Done':
      return null;
    case 'TodoUpdate':
      return JSON.stringify({ type: 'todo_update', items: event.items });
    default:
      return null;
  }
}

export async function* toSSEString(
  source: AsyncGenerator<AgentEvent, any, unknown>,
): AsyncGenerator<string, void, unknown> {
  for await (const event of source) {
    const text = formatEventForTransport(event);
    if (text !== null) yield text;
  }
}
