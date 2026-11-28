import { Context } from 'effect';
import type { Effect } from 'effect';
import type { ConfigScope } from '@codingcode/util';
import type {
  CreateHookCommand,
  DeleteHookCommand,
  HookConfigEntry,
  HookConfigOutcome,
  HookDecision,
  HookPayloadMap,
  HookPoint,
  SetHookEnabledCommand,
  UpdateHookCommand,
} from './types.js';

export interface HookShape {
  emit<P extends HookPoint>(point: P, payload: HookPayloadMap[P]): Effect.Effect<void>;
  emitDecision<P extends HookPoint>(
    point: P,
    payload: HookPayloadMap[P]
  ): Effect.Effect<HookDecision | null>;
  reloadUserHooks(projectPath: string): Effect.Effect<void>;

  listHooks(scope: ConfigScope): Effect.Effect<HookConfigEntry[]>;
  createHook(cmd: CreateHookCommand): Effect.Effect<HookConfigOutcome>;
  updateHook(cmd: UpdateHookCommand): Effect.Effect<HookConfigOutcome>;
  deleteHook(cmd: DeleteHookCommand): Effect.Effect<HookConfigOutcome>;
  setHookEnabled(cmd: SetHookEnabledCommand): Effect.Effect<void>;
}

export class HookService extends Context.Tag('HookService')<HookService, HookShape>() {}
