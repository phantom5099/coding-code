import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { afterPlanSubmittedObserver } from '../../src/plan/index.js';

async function runObserver(payload: Record<string, unknown>): Promise<unknown> {
  const result = afterPlanSubmittedObserver(payload as any);
  return Effect.runPromise(result as Effect.Effect<unknown>);
}

describe('afterPlanSubmittedObserver', () => {
  it('is an Effect-returning observer (not fire-and-forget Promise)', () => {
    // The whole point of the fix: the observer must return an Effect so it
    // can yield* services in the emit fiber's context. A Promise<void> or
    // void return would force us back to Effect.runFork / default runtime.
    const result = afterPlanSubmittedObserver({} as any);
    expect(result).toBeDefined();
    // Effect has a .pipe method; Promise<void> and void do not.
    expect(typeof (result as { pipe?: unknown }).pipe).toBe('function');
  });

  it('no-ops on non-submit_plan tool', async () => {
    await expect(
      runObserver({
        toolName: 'write_file',
        args: { path: '/x' },
        sessionId: 's',
        projectPath: '/proj',
        result: { output: 'Plan written to /x' },
      })
    ).resolves.toBeUndefined();
  });

  it('no-ops when submit_plan result does not start with "Plan written to "', async () => {
    await expect(
      runObserver({
        toolName: 'submit_plan',
        args: { plan_content: '# plan' },
        sessionId: 's',
        projectPath: '/proj',
        result: { output: 'some other output' },
      })
    ).resolves.toBeUndefined();
  });

  it('no-ops when sessionId is missing', async () => {
    await expect(
      runObserver({
        toolName: 'submit_plan',
        args: { plan_content: '# plan' },
        projectPath: '/proj',
        result: { output: 'Plan written to /x' },
      })
    ).resolves.toBeUndefined();
  });

  it('no-ops when projectPath is missing', async () => {
    await expect(
      runObserver({
        toolName: 'submit_plan',
        args: { plan_content: '# plan' },
        sessionId: 's',
        result: { output: 'Plan written to /x' },
      })
    ).resolves.toBeUndefined();
  });

  it('no-ops when plan_content is missing', async () => {
    await expect(
      runObserver({
        toolName: 'submit_plan',
        args: {},
        sessionId: 's',
        projectPath: '/proj',
        result: { output: 'Plan written to /x' },
      })
    ).resolves.toBeUndefined();
  });
});
