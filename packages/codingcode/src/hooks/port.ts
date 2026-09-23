import { Context } from 'effect';
import type { Effect } from 'effect';
import type { HookPoint, HookDecision } from '../contracts/hooks.js';
import type { ObserverHandler, DecisionHandler } from './types.js';

export interface HookShape {
  register(point: HookPoint, handler: ObserverHandler, opts?: { source?: 'system' | 'user' }): Effect.Effect<() => void>;
  registerDecision(point: HookPoint, handler: DecisionHandler, opts?: { priority?: number; source?: 'system' | 'user' }): Effect.Effect<() => void>;
  emit(point: HookPoint, payload: Record<string, unknown>): Effect.Effect<void>;
  emitDecision(point: HookPoint, payload: Record<string, unknown>): Effect.Effect<HookDecision | null>;
  reloadUserHooks(projectPath: string): Effect.Effect<void>;
  disposeSession(sessionId: string): Effect.Effect<void>;
}

export class HookService extends Context.Tag('HookService')<HookService, HookShape>() {}
