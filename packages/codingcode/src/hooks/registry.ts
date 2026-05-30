import { Effect } from 'effect';
import { loadHookConfigs } from './config';
import { executeHookCommand, executeDecisionHookCommand, isHookRuntimeEnabled } from './executor';
import { createLogger } from '@codingcode/infra';

const logger = createLogger();

export type HookPoint =
  | 'tool.execute.before' | 'tool.execute.after' | 'tool.execute.error'
  | 'tool.execute.denied'
  | 'tool.approval.pre' | 'tool.approval.post'
  | 'llm.request.before' | 'llm.response.after' | 'llm.response.error'
  | 'session.save.before' | 'session.save.after'
  | 'agent.turn.start'
  | 'agent.step.before'
  | 'agent.turn.stop'
  | 'agent.turn.end'
  | 'agent.subagent.spawn.before'
  | 'agent.subagent.spawn.after'
  | 'agent.subagent.complete';

export interface HookDecision {
  decision?: 'allow' | 'deny' | 'ask' | 'continue';
  reason?: string;
  injection?: string;
  modifiedInput?: Record<string, unknown>;
  modifiedOutput?: unknown;
}

type ObserverHandler = (payload: Record<string, unknown>) => void | Promise<void>;
type DecisionHandler = (
  payload: Record<string, unknown>,
) => HookDecision | null | Promise<HookDecision | null>;

interface HandlerEntry {
  id: string;
  handler: ObserverHandler | DecisionHandler;
  priority: number;
  source: 'system' | 'user';
  type: 'observer' | 'decision';
}

let entryCounter = 0;

export class HookService extends Effect.Service<HookService>()('HookService', {
  effect: Effect.gen(function* () {
    const observers = new Map<HookPoint, HandlerEntry[]>();

    function sortedEntries(point: HookPoint): HandlerEntry[] {
      return (observers.get(point) ?? []).slice().sort((a, b) => a.priority - b.priority);
    }

    return {
      /** Register an observation handler (fire-and-forget, no return value). */
      register: (
        point: HookPoint,
        handler: ObserverHandler,
        opts?: { source?: 'system' | 'user' },
      ): Effect.Effect<() => void> =>
        Effect.sync(() => {
          const entry: HandlerEntry = {
            id: `obs-${++entryCounter}`,
            handler,
            priority: 0,
            source: opts?.source ?? 'user',
            type: 'observer',
          };
          const set = observers.get(point) ?? [];
          set.push(entry);
          observers.set(point, set);
          return () => {
            const s = observers.get(point);
            if (s) {
              const idx = s.indexOf(entry);
              if (idx >= 0) s.splice(idx, 1);
            }
          };
        }),

      /** Register a decision handler with priority (lower runs first). */
      registerDecision: (
        point: HookPoint,
        handler: DecisionHandler,
        opts?: { priority?: number; source?: 'system' | 'user' },
      ): Effect.Effect<() => void> =>
        Effect.sync(() => {
          const entry: HandlerEntry = {
            id: `dec-${++entryCounter}`,
            handler,
            priority: opts?.priority ?? 0,
            source: opts?.source ?? 'user',
            type: 'decision',
          };
          const set = observers.get(point) ?? [];
          set.push(entry);
          observers.set(point, set);
          return () => {
            const s = observers.get(point);
            if (s) {
              const idx = s.indexOf(entry);
              if (idx >= 0) s.splice(idx, 1);
            }
          };
        }),

      /** Emit an observer event (fire-and-forget all handlers). */
      emit: (point: HookPoint, payload: Record<string, unknown>): Effect.Effect<void> =>
        Effect.promise(async () => {
          for (const entry of sortedEntries(point)) {
            if (entry.type === 'observer') {
              try {
                await (entry.handler as ObserverHandler)(payload);
              } catch (e) {
                logger.error(`hook emit error [${point}]:`, e);
              }
            }
          }
        }),

      /** Emit a decision event. Handlers run in priority order; first non-null decision wins. */
      emitDecision: (
        point: HookPoint,
        payload: Record<string, unknown>,
      ): Effect.Effect<HookDecision | null> =>
        Effect.promise(async () => {
          for (const entry of sortedEntries(point)) {
            if (entry.type === 'decision') {
              try {
                const result = await (entry.handler as DecisionHandler)(payload);
                if (result != null) return result;
              } catch (e) {
                logger.error(`hook emitDecision error [${point}]:`, e);
              }
            }
          }
          return null;
        }),

      /** Reload user-defined hooks from hooks.yaml, replacing previously loaded user hooks. */
      reloadUserHooks: (cwd: string): Effect.Effect<void> =>
        Effect.sync(() => {
          for (const [point, entries] of observers) {
            const filtered = entries.filter(e => e.source !== 'user');
            if (filtered.length === 0) observers.delete(point);
            else observers.set(point, filtered);
          }
          for (const hc of loadHookConfigs(cwd)) {
            if (!hc.enabled) continue;
            const hookName = hc.name;
            const entry: HandlerEntry = {
              id: `${hc.type === 'observer' ? 'obs' : 'dec'}-${++entryCounter}`,
              handler: hc.type === 'observer'
                ? (payload: Record<string, unknown>) => {
                    if (!isHookRuntimeEnabled(hookName)) return;
                    return executeHookCommand(hc, payload);
                  }
                : (payload: Record<string, unknown>) => {
                    if (!isHookRuntimeEnabled(hookName)) return null;
                    return executeDecisionHookCommand(hc, payload);
                  },
              priority: hc.priority ?? 0,
              source: 'user',
              type: hc.type,
            };
            const set = observers.get(hc.point) ?? [];
            set.push(entry);
            observers.set(hc.point, set);
          }
        }),
    };
  }),
}) {}
