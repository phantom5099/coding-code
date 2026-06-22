import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { AppLayer } from '../../src/layer.js';
import { HookService } from '../../src/hooks/registry.js';
import { afterPlanSubmittedObserver } from '../../src/plan/index.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { SessionService } from '../../src/session/store.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

async function setupSessionInPlanMode(): Promise<string> {
  return run(
    Effect.gen(function* () {
      const session = yield* SessionService;
      const state = yield* session.create('/tmp/test-project', 'test-model');
      const runtime = yield* ProjectRuntimeService;
      yield* runtime.prepareProject('/tmp/test-project');
      const planProfile = runtime.resolveSubagentProfile('/tmp/test-project', 'plan')!;
      yield* runtime.setSessionProfile('/tmp/test-project', state.sessionId, planProfile);
      return state.sessionId;
    })
  );
}

describe('afterPlanSubmittedObserver', () => {
  it('emits plan.ready hook when submit_plan returns "Plan written to ..."', async () => {
    let capturedPayload: any = null;
    const sessionId = await setupSessionInPlanMode();

    await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.register('plan.ready', (payload) => {
          capturedPayload = payload;
        });

        yield* afterPlanSubmittedObserver({
          toolName: 'submit_plan',
          toolCallId: 'tc-1',
          args: { title: 'My Plan', plan_content: '# My Plan\n\nbody content' },
          sessionId,
          projectPath: '/tmp/test-project',
          result: { output: 'Plan written to /tmp/test-project/plans/my-plan.md' },
        });
      })
    );

    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.sessionId).toBe(sessionId);
    expect(capturedPayload.title).toBe('My Plan');
    expect(capturedPayload.path).toBe('/tmp/test-project/plans/my-plan.md');
    expect(capturedPayload.content).toBe('# My Plan\n\nbody content');
    expect(capturedPayload.projectPath).toBe('/tmp/test-project');
  });

  it('does NOT emit plan.ready when tool is not submit_plan', async () => {
    let emitted = false;
    const sessionId = await setupSessionInPlanMode();

    await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.register('plan.ready', () => {
          emitted = true;
        });
        yield* afterPlanSubmittedObserver({
          toolName: 'write_file',
          sessionId,
          projectPath: '/tmp/test-project',
          args: { title: 'X', plan_content: 'X' },
          result: { output: 'Plan written to /tmp/x' },
        });
      })
    );
    expect(emitted).toBe(false);
  });

  it('does NOT emit plan.ready when output does not start with "Plan written to "', async () => {
    let emitted = false;
    const sessionId = await setupSessionInPlanMode();

    await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.register('plan.ready', () => {
          emitted = true;
        });
        yield* afterPlanSubmittedObserver({
          toolName: 'submit_plan',
          sessionId,
          projectPath: '/tmp/test-project',
          args: { title: 'X', plan_content: 'X' },
          result: { output: 'Some other output' },
        });
      })
    );
    expect(emitted).toBe(false);
  });

  it('does NOT emit plan.ready when plan_content is missing', async () => {
    let emitted = false;
    const sessionId = await setupSessionInPlanMode();

    await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.register('plan.ready', () => {
          emitted = true;
        });
        yield* afterPlanSubmittedObserver({
          toolName: 'submit_plan',
          sessionId,
          projectPath: '/tmp/test-project',
          args: { title: 'X' },
          result: { output: 'Plan written to /tmp/x' },
        });
      })
    );
    expect(emitted).toBe(false);
  });
});
