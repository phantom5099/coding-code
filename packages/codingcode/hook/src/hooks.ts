import { Layer, Effect } from 'effect';
import {
  loadHookConfigs,
  resolveHookConfigs,
  setHookEnabledConfig,
  writeHookConfigs,
} from './config.js';
import { executeHookCommand, executeDecisionHookCommand } from './executor.js';
import { createLogger } from '@codingcode/infra';
import { GLOBAL_CONFIG_SCOPE, type ConfigScope } from '@codingcode/util';
import { HookService } from './port.js';
import type {
  CreateHookCommand,
  DecisionHandler,
  DeleteHookCommand,
  HandlerEntry,
  HookCommandOutput,
  HookConfigEntry,
  HookConfigOutcome,
  HookDecision,
  HookDecisionKind,
  HookPayloadMap,
  HookPoint,
  ObserverHandler,
  SetHookEnabledCommand,
  UpdateHookCommand,
  UserHookConfig,
} from './types.js';

const logger = createLogger();

const DECISION_VALUES: ReadonlySet<string> = new Set<HookDecisionKind>([
  'allow',
  'deny',
  'ask',
  'continue',
]);

/** 外部进程输出 → 决策语义：只认已知键，其余丢弃。 */
function toHookDecision(output: HookCommandOutput): HookDecision {
  const decision =
    typeof output.decision === 'string' && DECISION_VALUES.has(output.decision)
      ? (output.decision as HookDecisionKind)
      : undefined;
  return {
    decision,
    reason: typeof output.reason === 'string' ? output.reason : undefined,
    injection: typeof output.injection === 'string' ? output.injection : undefined,
    modifiedInput:
      output.modifiedInput && typeof output.modifiedInput === 'object'
        ? (output.modifiedInput as Record<string, unknown>)
        : undefined,
  };
}

export const HookLayer = Layer.effect(
  HookService,
  Effect.sync(() => {
    const hooksByProject = new Map<string, Map<HookPoint, HandlerEntry[]>>();

    /** 某个项目在某个 hook 点上生效的 handler，按 priority 升序 */
    function handlersFor(point: HookPoint, projectPath?: string): HandlerEntry[] {
      const list = projectPath ? hooksByProject.get(projectPath)?.get(point) : undefined;
      if (!list) return [];
      return list.slice().sort((a, b) => a.priority - b.priority);
    }

    /** 开关归一：缺省（undefined）等同启用 */
    function enabledOf(hook: UserHookConfig): UserHookConfig & { enabled: boolean } {
      return { ...hook, enabled: hook.enabled !== false };
    }

    return {
      emit: <P extends HookPoint>(point: P, payload: HookPayloadMap[P]): Effect.Effect<void> =>
        Effect.gen(function* () {
          for (const entry of handlersFor(point, payload.projectPath)) {
            if (entry.type !== 'observer') continue;
            yield* entry.handler(payload).pipe(
              Effect.catchAll((e) =>
                Effect.sync(() => logger.error(`hook emit error [${point}]:`, e))
              )
            );
          }
        }),

      emitDecision: <P extends HookPoint>(
        point: P,
        payload: HookPayloadMap[P]
      ): Effect.Effect<HookDecision | null> =>
        Effect.promise(async () => {
          for (const entry of handlersFor(point, payload.projectPath)) {
            if (entry.type !== 'decision') continue;
            try {
              const result = await entry.handler(payload);
              if (result != null) return result;
            } catch (e) {
              logger.error(`hook emitDecision error [${point}]:`, e);
            }
          }
          return null;
        }),

      reloadUserHooks: (projectPath: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const projectMap = new Map<HookPoint, HandlerEntry[]>();
          for (const hc of resolveHookConfigs(projectPath)) {
            if (hc.enabled === false) continue;
            const hookName = hc.name;
            const entry: HandlerEntry =
              hc.type === 'observer'
                ? {
                    type: 'observer',
                    priority: hc.priority ?? 0,
                    handler: ((payload) =>
                      Effect.tryPromise({
                        try: () => executeHookCommand(hc, payload),
                        catch: (e) => logger.error(`user hook ${hookName} error:`, e),
                      }).pipe(Effect.ignore)) satisfies ObserverHandler,
                  }
                : {
                    type: 'decision',
                    priority: hc.priority ?? 0,
                    handler: (async (payload) => {
                      try {
                        const output = await executeDecisionHookCommand(hc, payload);
                        return output ? toHookDecision(output) : null;
                      } catch (e) {
                        logger.error(`user decision hook ${hookName} error:`, e);
                        return null;
                      }
                    }) satisfies DecisionHandler,
                  };
            const list = projectMap.get(hc.point) ?? [];
            list.push(entry);
            projectMap.set(hc.point, list);
          }
          hooksByProject.set(projectPath, projectMap);
        }),

      listHooks: (scope: ConfigScope): Effect.Effect<HookConfigEntry[]> =>
        Effect.sync(() => {
          const globalHooks = loadHookConfigs(GLOBAL_CONFIG_SCOPE);
          if (scope.kind === 'global') {
            return globalHooks.map((h) => ({ ...enabledOf(h), source: 'global' as const }));
          }
          const projectHooks = loadHookConfigs(scope);
          const globalNames = new Set(globalHooks.map((h) => h.name));
          const projectNames = new Set(projectHooks.map((h) => h.name));
          return resolveHookConfigs(scope.projectPath).map((h) => {
            const isFromProject = projectNames.has(h.name);
            const isFromGlobal = globalNames.has(h.name);
            return {
              ...enabledOf(h),
              source: isFromProject ? ('project' as const) : ('global' as const),
              hasProjectOverride: isFromProject && isFromGlobal,
            };
          });
        }),

      createHook: (cmd: CreateHookCommand): Effect.Effect<HookConfigOutcome> =>
        Effect.sync(() => {
          const hooks = loadHookConfigs(cmd.scope);
          if (hooks.some((h) => h.name === cmd.hook.name)) {
            return { ok: false, reason: 'already-exists' } as const;
          }
          hooks.push(cmd.hook);
          writeHookConfigs(cmd.scope, hooks);
          return { ok: true } as const;
        }),

      updateHook: (cmd: UpdateHookCommand): Effect.Effect<HookConfigOutcome> =>
        Effect.sync(() => {
          const hooks = loadHookConfigs(cmd.scope);
          const idx = hooks.findIndex((h) => h.name === cmd.name);
          if (idx === -1) return { ok: false, reason: 'not-found' } as const;
          if (cmd.hook.name !== cmd.name && hooks.some((h) => h.name === cmd.hook.name)) {
            return { ok: false, reason: 'already-exists' } as const;
          }
          hooks[idx] = cmd.hook;
          writeHookConfigs(cmd.scope, hooks);
          return { ok: true } as const;
        }),

      deleteHook: (cmd: DeleteHookCommand): Effect.Effect<HookConfigOutcome> =>
        Effect.sync(() => {
          const hooks = loadHookConfigs(cmd.scope);
          if (cmd.scope.kind === 'project' && !hooks.some((h) => h.name === cmd.name)) {
            return { ok: false, reason: 'not-found' } as const;
          }
          writeHookConfigs(
            cmd.scope,
            hooks.filter((h) => h.name !== cmd.name)
          );
          return { ok: true } as const;
        }),

      setHookEnabled: (cmd: SetHookEnabledCommand): Effect.Effect<void> =>
        Effect.sync(() => setHookEnabledConfig(cmd)),
    };
  })
);
