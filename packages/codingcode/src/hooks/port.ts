import { Context } from 'effect';
import type { Effect } from 'effect';
import type {
  HookPoint,
  HookDecision,
  HookConfigEntry,
  HookConfigOutcome,
  UserHookConfig,
} from './types.js';

export interface HookShape {
  emit(point: HookPoint, payload: Record<string, unknown>): Effect.Effect<void>;
  emitDecision(
    point: HookPoint,
    payload: Record<string, unknown>
  ): Effect.Effect<HookDecision | null>;
  reloadUserHooks(projectPath: string): Effect.Effect<void>;

  /** projectPath 省略(undefined) = 全局层，模块内部经 getGlobalDir() 定位 */
  listHooks(projectPath?: string): Effect.Effect<HookConfigEntry[]>;
  createHook(
    projectPath: string | undefined,
    hook: UserHookConfig
  ): Effect.Effect<HookConfigOutcome>;
  updateHook(
    projectPath: string | undefined,
    name: string,
    hook: UserHookConfig
  ): Effect.Effect<HookConfigOutcome>;
  deleteHook(projectPath: string | undefined, name: string): Effect.Effect<HookConfigOutcome>;
  setHookEnabled(
    projectPath: string | undefined,
    name: string,
    enabled: boolean
  ): Effect.Effect<void>;
}

export class HookService extends Context.Tag('HookService')<HookService, HookShape>() {}
