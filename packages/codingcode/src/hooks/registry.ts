import { Effect } from 'effect';
import { resolveHookConfigs, resolveHookDisabled } from './config.js';
import {
  executeHookCommand,
  executeDecisionHookCommand,
  isHookRuntimeEnabled,
} from './executor.js';
import { createLogger } from '@codingcode/infra/logger';
import type {
  HookPoint,
  HookDecision,
  ObserverHandler,
  DecisionHandler,
  HandlerEntry,
  ProjectPath,
  SessionId,
  HookName,
} from './types.js';

const logger = createLogger();

export class HookService extends Effect.Service<HookService>()('HookService', {
  effect: Effect.gen(function* () {
    let entryCounter = 0;
    const globalHooks = new Map<HookPoint, HandlerEntry[]>();
    const hooksByProject = new Map<ProjectPath, Map<HookPoint, HandlerEntry[]>>();
    const hooksBySession = new Map<SessionId, Map<HookPoint, HandlerEntry[]>>();
    const disabledHooksByProject = new Map<ProjectPath, Set<HookName>>();
    const disabledHooksBySession = new Map<SessionId, Set<HookName>>();

    function getMapForScope(
      projectPath?: string,
      sessionId?: string
    ): Map<HookPoint, HandlerEntry[]>[] {
      const maps: Map<HookPoint, HandlerEntry[]>[] = [globalHooks];
      if (projectPath) {
        let pmap = hooksByProject.get(projectPath);
        if (!pmap) {
          pmap = new Map();
          hooksByProject.set(projectPath, pmap);
        }
        maps.push(pmap);
      }
      if (sessionId) {
        let smap = hooksBySession.get(sessionId);
        if (!smap) {
          smap = new Map();
          hooksBySession.set(sessionId, smap);
        }
        maps.push(smap);
      }
      return maps;
    }

    function sortedEntries(point: HookPoint, entries: HandlerEntry[]): HandlerEntry[] {
      return entries.slice().sort((a, b) => a.priority - b.priority);
    }

    function allHandlers(
      point: HookPoint,
      projectPath?: string,
      sessionId?: string
    ): HandlerEntry[] {
      const result: HandlerEntry[] = [];
      // global → project → session
      const globalList = globalHooks.get(point);
      if (globalList) result.push(...globalList);
      if (projectPath) {
        const projectList = hooksByProject.get(projectPath)?.get(point);
        if (projectList) result.push(...projectList);
      }
      if (sessionId) {
        const sessionList = hooksBySession.get(sessionId)?.get(point);
        if (sessionList) result.push(...sessionList);
      }
      return sortedEntries(point, result);
    }

    function isHookDisabled(name: string, projectPath?: string, sessionId?: string): boolean {
      if (sessionId && disabledHooksBySession.get(sessionId)?.has(name)) return true;
      if (projectPath && resolveHookDisabled(projectPath, name)) return true;
      return false;
    }

    return {
      register: (
        point: HookPoint,
        handler: ObserverHandler,
        opts?: { source?: 'system' | 'user' }
      ): Effect.Effect<() => void> =>
        Effect.sync(() => {
          const entry: HandlerEntry = {
            id: `obs-${++entryCounter}`,
            handler,
            priority: 0,
            source: opts?.source ?? 'user',
            type: 'observer',
          };
          const set = globalHooks.get(point) ?? [];
          set.push(entry);
          globalHooks.set(point, set);
          return () => {
            const idx = set.indexOf(entry);
            if (idx >= 0) set.splice(idx, 1);
          };
        }),

      registerDecision: (
        point: HookPoint,
        handler: DecisionHandler,
        opts?: { priority?: number; source?: 'system' | 'user' }
      ): Effect.Effect<() => void> =>
        Effect.sync(() => {
          const entry: HandlerEntry = {
            id: `dec-${++entryCounter}`,
            handler,
            priority: opts?.priority ?? 0,
            source: opts?.source ?? 'system',
            type: 'decision',
          };
          const set = globalHooks.get(point) ?? [];
          set.push(entry);
          globalHooks.set(point, set);
          return () => {
            const idx = set.indexOf(entry);
            if (idx >= 0) set.splice(idx, 1);
          };
        }),

      emit: (point: HookPoint, payload: Record<string, unknown>): Effect.Effect<void> => {
        const projectPath = payload.projectPath as string | undefined;
        const sessionId = payload.sessionId as string | undefined;
        // Internally `emit` may run Effect-returning observers that `yield*`
        // services from the caller's fiber. The declared R is `never` so
        // existing `Effect.runPromise(emit)` fire-and-forget call sites keep
        // compiling; observers that need services should only be registered
        // for hook points emitted from a fiber that provides them
        // (e.g. `tool.execute.after` from `ToolExecutorService`).
        return Effect.gen(function* () {
          for (const entry of allHandlers(point, projectPath, sessionId)) {
            if (entry.type === 'observer') {
              const name = entry.id;
              if (isHookDisabled(name, projectPath, sessionId)) continue;
              const result = entry.handler(payload);
              if (result == null) {
                continue;
              }
              if (typeof (result as { pipe?: unknown }).pipe === 'function') {
                // Effect-returning observer: run in this fiber's context.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                yield* (result as Effect.Effect<void, never, any>).pipe(
                  Effect.catchAll((e) =>
                    Effect.sync(() => logger.error(`hook emit error [${point}]:`, e))
                  )
                ) as Effect.Effect<void>;
              } else {
                yield* Effect.tryPromise({
                  try: () => result as Promise<void>,
                  catch: (e) => logger.error(`hook emit error [${point}]:`, e),
                }).pipe(Effect.ignore);
              }
            }
          }
          // The gen's actual R is `any` (from inner Effects); expose `never`
          // to keep callers that do `Effect.runPromise(emit)` happy. See the
          // contract comment on `ObserverHandler` for the runtime guarantee.
        }) as Effect.Effect<void>;
      },

      emitDecision: (
        point: HookPoint,
        payload: Record<string, unknown>
      ): Effect.Effect<HookDecision | null> => {
        const projectPath = payload.projectPath as string | undefined;
        const sessionId = payload.sessionId as string | undefined;
        return Effect.promise(async () => {
          for (const entry of allHandlers(point, projectPath, sessionId)) {
            if (entry.type === 'decision') {
              const name = entry.id;
              if (isHookDisabled(name, projectPath, sessionId)) continue;
              try {
                const result = await (entry.handler as DecisionHandler)(payload);
                if (result != null) return result;
              } catch (e) {
                logger.error(`hook emitDecision error [${point}]:`, e);
              }
            }
          }
          return null;
        });
      },

      reloadUserHooks: (projectPath: string): Effect.Effect<void> =>
        Effect.sync(() => {
          // Clear user-sourced hooks from globalHooks
          for (const [point, entries] of globalHooks) {
            const filtered = entries.filter((e) => e.source !== 'user');
            if (filtered.length === 0) globalHooks.delete(point);
            else globalHooks.set(point, filtered);
          }
          hooksByProject.delete(projectPath);
          const projectMap = new Map<HookPoint, HandlerEntry[]>();
          for (const hc of resolveHookConfigs(projectPath)) {
            if (resolveHookDisabled(projectPath, hc.name)) continue;
            const hookName = hc.name;
            const observerHandler: ObserverHandler = (payload) => {
              if (!isHookRuntimeEnabled(hookName)) return;
              return Effect.tryPromise({
                try: () => executeHookCommand(hc, payload),
                catch: (e) => logger.error(`user hook ${hookName} error:`, e),
              }).pipe(Effect.ignore);
            };
            const decisionHandler: DecisionHandler = (payload) => {
              if (!isHookRuntimeEnabled(hookName)) return null;
              return Effect.tryPromise({
                try: () => executeDecisionHookCommand(hc, payload),
                catch: (e) => {
                  logger.error(`user decision hook ${hookName} error:`, e);
                  return null;
                },
              }) as unknown as Promise<HookDecision | null>;
            };
            const entry: HandlerEntry = {
              id: `${hc.type === 'observer' ? 'obs' : 'dec'}-${++entryCounter}`,
              handler: hc.type === 'observer' ? observerHandler : decisionHandler,
              priority: hc.priority ?? 0,
              source: 'user',
              type: hc.type,
            };
            const set = projectMap.get(hc.point) ?? [];
            set.push(entry);
            projectMap.set(hc.point, set);
          }
          hooksByProject.set(projectPath, projectMap);
        }),

      attachSessionHooks: (
        sessionId: string,
        hooks: {
          name: string;
          point: HookPoint;
          type: 'observer' | 'decision';
          command: string;
          args?: string[];
          priority?: number;
        }[]
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          const sessionMap = new Map<HookPoint, HandlerEntry[]>();
          for (const hc of hooks) {
            const observerHandler: ObserverHandler = (payload) =>
              Effect.tryPromise({
                try: () =>
                  executeHookCommand({ command: hc.command, args: hc.args, env: {} }, payload),
                catch: (e) => logger.error(`session hook ${hc.name} error:`, e),
              }).pipe(Effect.ignore);
            const decisionHandler: DecisionHandler = (payload) =>
              Effect.tryPromise({
                try: () =>
                  executeDecisionHookCommand(
                    { command: hc.command, args: hc.args, env: {} },
                    payload
                  ),
                catch: (e) => {
                  logger.error(`session decision hook ${hc.name} error:`, e);
                  return null;
                },
              }) as unknown as Promise<HookDecision | null>;
            const entry: HandlerEntry = {
              id: `session-${hc.name}-${++entryCounter}`,
              handler: hc.type === 'observer' ? observerHandler : decisionHandler,
              priority: hc.priority ?? 0,
              source: 'user',
              type: hc.type,
            };
            const set = sessionMap.get(hc.point) ?? [];
            set.push(entry);
            sessionMap.set(hc.point, set);
          }
          hooksBySession.set(sessionId, sessionMap);
        }),

      disableHook: (projectPath: string, name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          let set = disabledHooksByProject.get(projectPath);
          if (!set) {
            set = new Set();
            disabledHooksByProject.set(projectPath, set);
          }
          set.add(name);
        }),

      enableHook: (projectPath: string, name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          disabledHooksByProject.get(projectPath)?.delete(name);
        }),

      disposeSession: (sessionId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          hooksBySession.delete(sessionId);
          disabledHooksBySession.delete(sessionId);
        }),

      disposeProject: (projectPath: string): Effect.Effect<void> =>
        Effect.sync(() => {
          hooksByProject.delete(projectPath);
          disabledHooksByProject.delete(projectPath);
        }),
    };
  }),
}) {}
