export type HookPoint =
  | 'tool.execute.before' | 'tool.execute.after' | 'tool.execute.error'
  | 'llm.request.before' | 'llm.response.after' | 'llm.response.error'
  | 'session.save.before' | 'session.save.after';

type HookHandler = (payload: Record<string, unknown>) => void | Promise<void>;

export class HookRegistry {
  private handlers = new Map<HookPoint, Set<HookHandler>>();

  register(point: HookPoint, handler: HookHandler): () => void {
    const set = this.handlers.get(point) ?? new Set();
    set.add(handler);
    this.handlers.set(point, set);
    return () => set.delete(handler);
  }

  async emit(point: HookPoint, payload: Record<string, unknown>): Promise<void> {
    const set = this.handlers.get(point);
    if (!set) return;
    for (const handler of set) await handler(payload);
  }
}
