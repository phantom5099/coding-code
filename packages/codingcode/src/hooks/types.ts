import type { Effect } from 'effect';
import type { HookDecision } from '../contracts/hooks.js';

export type ObserverHandler = (
  payload: Record<string, unknown>
) => Effect.Effect<void, never, any> | void | Promise<void>;

export type DecisionHandler = (
  payload: Record<string, unknown>
) => HookDecision | null | Promise<HookDecision | null>;

export interface HandlerEntry {
  id: string;
  handler: ObserverHandler | DecisionHandler;
  priority: number;
  source: 'system' | 'user';
  type: 'observer' | 'decision';
}

export type ProjectPath = string;
export type SessionId = string;
export type HookName = string;
