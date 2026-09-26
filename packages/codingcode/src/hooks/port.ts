import { Context } from 'effect';
import type { Effect } from 'effect';
import type { HookPoint, HookDecision } from '../contracts/hooks.js';

export interface HookShape {
  emit(point: HookPoint, payload: Record<string, unknown>): Effect.Effect<void>;
  emitDecision(point: HookPoint, payload: Record<string, unknown>): Effect.Effect<HookDecision | null>;
  reloadUserHooks(projectPath: string): Effect.Effect<void>;
}

export class HookService extends Context.Tag('HookService')<HookService, HookShape>() {}
