import type { AgentEvent } from './types.js';
import type { StreamChunk } from '../client/types.js';

export async function* agentEventToStreamChunk(
  source: AsyncGenerator<AgentEvent, any, unknown>
): AsyncGenerator<StreamChunk, void, unknown> {
  let currentStep = 0;
  for await (const event of source) {
    switch (event._tag) {
      case 'Step':
        currentStep = event.step;
        break;
      case 'TurnId':
        yield { type: 'turn_id', turnId: event.turnId };
        break;
      case 'LlmChunk':
        yield { type: 'text', text: event.text, messageId: currentStep };
        break;
      case 'Assistant':
        yield { type: 'message', id: currentStep, content: event.content, partial: false };
        break;
      case 'ToolStart':
        yield { type: 'tool_start', id: event.id, name: event.name, args: event.args };
        break;
      case 'ToolResult':
        yield {
          type: 'tool_result',
          id: event.id,
          name: event.name,
          output: event.output,
          ok: event.ok,
        };
        break;
      case 'ToolDenied':
        yield { type: 'tool_denied', id: event.id, name: event.name, reason: event.reason };
        break;
      case 'Error':
        yield {
          type: 'error',
          message: event.error.message ?? String(event.error),
          code: event.error.code,
        };
        break;
      case 'Done':
        yield { type: 'done' };
        break;
      case 'TodoUpdate':
        yield { type: 'todo_update', items: event.items as any };
        break;
      case 'Usage':
        yield {
          type: 'usage',
          prompt: event.prompt,
          completion: event.completion,
          total: event.total,
        };
        break;
      case 'ReactiveCompact':
        yield {
          type: 'reactive_compact',
          released: event.released,
          promptEstimate: event.promptEstimate,
        };
        break;
    }
  }
}
