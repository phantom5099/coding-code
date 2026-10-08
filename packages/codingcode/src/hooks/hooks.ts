import { Layer, Effect } from 'effect';
import { resolveHookConfigs } from './config.js';
import { executeHookCommand, executeDecisionHookCommand } from './executor.js';
import { createLogger } from '../infra/logger.js';
import { HookService } from './port.js';
import type { HookPoint, HookDecision, HookCommandOutput } from './types.js';
import type { ObserverHandler, DecisionHandler, HandlerEntry, ProjectPath } from './types.js';

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
    };
  })
);
