import type { AgentError } from './error';
import type { Message, ToolCall, ToolDescription } from './types';

export type HookPoint =
  | 'tool.execute.before'
  | 'tool.execute.after'
  | 'tool.execute.error'
  | 'llm.request.before'
  | 'llm.response.after'
  | 'llm.response.error'
  | 'session.save.before'
  | 'session.save.after';

export type HookPayloadMap = {
  'tool.execute.before': { toolName: string; args: Record<string, unknown> };
  'tool.execute.after': { toolName: string; args: Record<string, unknown>; result: string; durationMs: number };
  'tool.execute.error': { toolName: string; args: Record<string, unknown>; error: AgentError };
  'llm.request.before': { messages: Message[]; tools: ToolDescription[] };
  'llm.response.after': { response: unknown; durationMs: number };
  'llm.response.error': { error: AgentError; messages: Message[] };
  'session.save.before': { events: unknown[] };
  'session.save.after': { events: unknown[] };
};

export class HookRegistry {
  private handlers = new Map<HookPoint, Set<Function>>();

  register<P extends keyof HookPayloadMap>(
    point: P,
    handler: (payload: HookPayloadMap[P]) => void | Promise<void>,
  ): () => void {
    const set = this.handlers.get(point) ?? new Set();
    set.add(handler);
    this.handlers.set(point, set);
    return () => set.delete(handler);
  }

  async emit<P extends keyof HookPayloadMap>(point: P, payload: HookPayloadMap[P]): Promise<void> {
    const set = this.handlers.get(point);
    if (!set) return;
    for (const handler of set) {
      await handler(payload);
    }
  }
}
