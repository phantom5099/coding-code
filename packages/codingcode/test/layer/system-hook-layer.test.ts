import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { HookService } from '../../src/hooks/registry.js';
import { SystemHookLayer } from '../../src/layer.js';
import { markSessionPlanMode, clearPlanModeSession } from '../../src/plan/index.js';

describe('SystemHookLayer', () => {
  it('builds without "Service not found: HookService" (regression: was a self-referential Layer.effect)', async () => {
    // The previous implementation used `Layer.effect(HookService, body-yielding-HookService)`
    // which Effect-TS does NOT support as a self-referential layer: the runtime
    // does not place a placeholder HookService in the environment while
    // building the layer, so the body's first `yield* HookService` would Die
    // with "Service not found: HookService". This test would fail to even
    // build the layer before the fix.
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      // touch the service to ensure it's resolvable from the build's output
      return typeof hooks.register;
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(SystemHookLayer) as any));
    expect(result).toBe('function');
  });

  it('registers the remaining plan-mode system hooks', async () => {
    // After the plan approval decoupling (option E):
    //   - planModeGateHook stays — it's the right abstraction for tool-allow
    //     policy. Registered on tool.approval.pre with priority -1000.
    //   - afterPlanSubmittedObserver stays — handles plan → build transition.
    //     Registered on tool.execute.after.
    //   - planApprovalHook REMOVED — submit_plan tool handles its own 3-option
    //     approval via ApprovalWaitService directly.
    //   - planSubagentWhitelistHook REMOVED — now an inline function
    //     (checkSubagentAllowedInPlanMode) called by dispatch_agent.
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;

      // (1) planModeGateHook denies write tools in plan mode
      markSessionPlanMode('s', true);
      const denied = yield* hooks.emitDecision('tool.approval.pre', {
        toolName: 'write_file',
        args: { path: '/x' },
        sessionId: 's',
        projectPath: '/p',
      });
      expect(denied).not.toBeNull();
      expect(denied?.decision).toBe('deny');
      expect(denied?.reason).toMatch(/plan mode/i);
      clearPlanModeSession('s');

      // (2) planModeGateHook lets submit_plan through
      markSessionPlanMode('s', true);
      const allowed = yield* hooks.emitDecision('tool.approval.pre', {
        toolName: 'submit_plan',
        args: { plan_content: '## plan' },
        sessionId: 's',
        projectPath: '/p',
      });
      expect(allowed).toBeNull();
      clearPlanModeSession('s');

      // (3) afterPlanSubmittedObserver is registered; emit should not throw
      // and an observer registered by us alongside should also fire.
      let ourObserverRan = false;
      yield* hooks.register('tool.execute.after', () =>
        Effect.sync(() => {
          ourObserverRan = true;
        })
      );
      yield* hooks.emit('tool.execute.after', { sessionId: 's', projectPath: '/p' });
      expect(ourObserverRan).toBe(true);

      return true;
    });

    await Effect.runPromise(program.pipe(Effect.provide(SystemHookLayer) as any));
  });
});
