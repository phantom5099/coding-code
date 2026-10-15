import { Layer, Effect } from 'effect';
import {
  resolveHookConfigs,
  loadHookConfigs,
  writeHookConfigs,
  loadGlobalHookConfigs,
  writeGlobalHookConfigs,
  setGlobalHookEnabled,
  setProjectHookEnabled,
} from './config.js';
import { executeHookCommand, executeDecisionHookCommand } from './executor.js';
import { createLogger } from '../infra/logger.js';
import { HookService } from './port.js';
import type { HookPoint, HookDecision, HookCommandOutput } from './types.js';
import type {
  ObserverHandler,
  DecisionHandler,
  HandlerEntry,
  ProjectPath,
  UserHookConfig,
  HookConfigEntry,
  HookConfigOutcome,
} from './types.js';

const logger = createLogger();

const DECISION_VALUES = new Set(['allow', 'deny', 'ask', 'continue']);

/** 外部进程输出 → 决策语义：只认已知键，其余丢弃。 */
function toHookDecision(output: HookCommandOutput): HookDecision {
  const decision =
    typeof output.decision === 'string' && DECISION_VALUES.has(output.decision)
      ? (output.decision as HookDecision['decision'])
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
  Effect.gen(function* () {
    const hooksByProject = new Map<ProjectPath, Map<HookPoint, HandlerEntry[]>>();

    /** 某个项目在某个 hook 点上生效的 handler，按 priority 升序 */
    function handlersFor(point: HookPoint, projectPath?: string): HandlerEntry[] {
      const list = projectPath ? hooksByProject.get(projectPath)?.get(point) : undefined;
      if (!list) return [];
      return list.slice().sort((a, b) => a.priority - b.priority);
    }

    // 配置读写：projectPath 省略 = 全局层
    function loadFor(projectPath?: string): UserHookConfig[] {
      return projectPath === undefined ? loadGlobalHookConfigs() : loadHookConfigs(projectPath);
    }

    function writeFor(projectPath: string | undefined, hooks: UserHookConfig[]): void {
      if (projectPath === undefined) writeGlobalHookConfigs(hooks);
      else writeHookConfigs(projectPath, hooks);
    }

    /** 开关归一：缺省（undefined）等同启用 */
    function enabledOf(hook: UserHookConfig): UserHookConfig & { enabled: boolean } {
      return { ...hook, enabled: hook.enabled !== false };
    }

    return {
      emit: (point: HookPoint, payload: Record<string, unknown>): Effect.Effect<void> => {
        const projectPath = payload.projectPath as string | undefined;
        return Effect.gen(function* () {
          for (const entry of handlersFor(point, projectPath)) {
            if (entry.type !== 'observer') continue;
            yield* (entry.handler as ObserverHandler)(payload).pipe(
              Effect.catchAll((e) =>
                Effect.sync(() => logger.error(`hook emit error [${point}]:`, e))
              )
            );
          }
        }) as Effect.Effect<void>;
      },

      emitDecision: (
        point: HookPoint,
        payload: Record<string, unknown>
      ): Effect.Effect<HookDecision | null> => {
        const projectPath = payload.projectPath as string | undefined;
        return Effect.promise(async () => {
          for (const entry of handlersFor(point, projectPath)) {
            if (entry.type !== 'decision') continue;
            try {
              const result = await (entry.handler as DecisionHandler)(payload);
              if (result != null) return result;
            } catch (e) {
              logger.error(`hook emitDecision error [${point}]:`, e);
            }
          }
          return null;
        });
      },

      reloadUserHooks: (projectPath: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const projectMap = new Map<HookPoint, HandlerEntry[]>();
          for (const hc of resolveHookConfigs(projectPath)) {
            // 开关就是配置里的 enabled 字段：被禁用的 hook 不注册
            if (hc.enabled === false) continue;
            const hookName = hc.name;
            const observerHandler: ObserverHandler = (payload) =>
              Effect.tryPromise({
                try: () => executeHookCommand(hc, payload),
                catch: (e) => logger.error(`user hook ${hookName} error:`, e),
              }).pipe(Effect.ignore);
            const decisionHandler: DecisionHandler = async (payload) => {
              try {
                const output = await executeDecisionHookCommand(hc, payload);
                return output ? toHookDecision(output) : null;
              } catch (e) {
                logger.error(`user decision hook ${hookName} error:`, e);
                return null;
              }
            };
            const entry: HandlerEntry = {
              handler: hc.type === 'observer' ? observerHandler : decisionHandler,
              priority: hc.priority ?? 0,
              type: hc.type,
            };
            const list = projectMap.get(hc.point) ?? [];
            list.push(entry);
            projectMap.set(hc.point, list);
          }
          hooksByProject.set(projectPath, projectMap);
        }),

      listHooks: (projectPath?: string): Effect.Effect<HookConfigEntry[]> =>
        Effect.sync(() => {
          const globalHooks = loadGlobalHookConfigs();
          // 全局窗口只列全局项，不带 hasProjectOverride
          if (projectPath === undefined) {
            return globalHooks.map((h) => ({ ...enabledOf(h), source: 'global' as const }));
          }
          const projectHooks = loadHookConfigs(projectPath);
          const globalNames = new Set(globalHooks.map((h) => h.name));
          const projectNames = new Set(projectHooks.map((h) => h.name));
          return resolveHookConfigs(projectPath).map((h) => {
            const isFromProject = projectNames.has(h.name);
            const isFromGlobal = globalNames.has(h.name);
            return {
              ...enabledOf(h),
              source: isFromProject ? ('project' as const) : ('global' as const),
              hasProjectOverride: isFromProject && isFromGlobal,
            };
          });
        }),

      createHook: (
        projectPath: string | undefined,
        hook: UserHookConfig
      ): Effect.Effect<HookConfigOutcome> =>
        Effect.sync(() => {
          const hooks = loadFor(projectPath);
          if (hooks.some((h) => h.name === hook.name)) {
            return { ok: false, reason: 'already-exists' } as const;
          }
          hooks.push(hook);
          writeFor(projectPath, hooks);
          return { ok: true } as const;
        }),

      updateHook: (
        projectPath: string | undefined,
        name: string,
        hook: UserHookConfig
      ): Effect.Effect<HookConfigOutcome> =>
        Effect.sync(() => {
          const hooks = loadFor(projectPath);
          const idx = hooks.findIndex((h) => h.name === name);
          if (idx === -1) return { ok: false, reason: 'not-found' } as const;
          if (hook.name !== name && hooks.some((h) => h.name === hook.name)) {
            return { ok: false, reason: 'already-exists' } as const;
          }
          hooks[idx] = hook;
          writeFor(projectPath, hooks);
          return { ok: true } as const;
        }),

      deleteHook: (
        projectPath: string | undefined,
        name: string
      ): Effect.Effect<HookConfigOutcome> =>
        Effect.sync(() => {
          const hooks = loadFor(projectPath);
          // 语义保持：项目层缺名报 not-found，全局层删除幂等
          if (projectPath !== undefined && !hooks.some((h) => h.name === name)) {
            return { ok: false, reason: 'not-found' } as const;
          }
          writeFor(
            projectPath,
            hooks.filter((h) => h.name !== name)
          );
          return { ok: true } as const;
        }),

      setHookEnabled: (
        projectPath: string | undefined,
        name: string,
        enabled: boolean
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          if (projectPath === undefined) setGlobalHookEnabled(name, enabled);
          else setProjectHookEnabled(projectPath, name, enabled);
        }),
    };
  })
);
