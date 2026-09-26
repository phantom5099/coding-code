import type { Effect } from 'effect';
import type { HookDecision } from '../contracts/hooks.js';

/** 观察者：只被通知，返回值被忽略 */
export type ObserverHandler = (payload: Record<string, unknown>) => Effect.Effect<void, never, any>;

/** 决策者：返回首个非 null 结果即短路 */
export type DecisionHandler = (
  payload: Record<string, unknown>
) => HookDecision | null | Promise<HookDecision | null>;

export interface HandlerEntry {
  handler: ObserverHandler | DecisionHandler;
  priority: number;
  type: 'observer' | 'decision';
}

export type ProjectPath = string;
