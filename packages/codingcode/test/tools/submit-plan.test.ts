import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Cause, Layer } from 'effect';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join, sep } from 'path';
import { tmpdir } from 'os';
import { submitPlanTool } from '../../src/tools/domains/subagent/submit-plan';
import { AgentError } from '../../src/core/error';
import { PlanApprovalService } from '../../src/plan/approval-service.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

const TEST_DIR = join(tmpdir(), 'codingcode-test-submit-plan');

const defaultPlanLayer = Layer.succeed(PlanApprovalService, {
  requestPlanDecision: () => Effect.succeed({ type: 'allow' as const }) as any,
  resolvePlanDecision: () => Effect.succeed(false),
  getPending: () => Effect.succeed([]),
  registerEmitter: () => Effect.succeed(undefined),
  unregisterEmitter: () => Effect.succeed(undefined),
  hasEmitter: () => Effect.succeed(false),
} as any);

function runWithDefaultPlan<A, E>(eff: Effect.Effect<A, E>) {
  return Effect.runPromise(eff.pipe(Effect.provide(defaultPlanLayer)));
}

describe('submitPlanTool', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('has the canonical name and shape expected by the plan-mode approval pipeline', () => {
    expect(submitPlanTool.name).toBe('submit_plan');
    expect(submitPlanTool.parameters).toBeDefined();
  });

  it('persists the plan content and reports the absolute path it wrote to', async () => {
    const sessionId = 'sess-001';
    const planContent = '# My Plan\n\n- step 1\n- step 2';

    const result = await runWithDefaultPlan(
      submitPlanTool.execute({ plan_content: planContent }, {
        projectPath: TEST_DIR,
        sessionId,
      } as any)
    );

    expect(result).toMatch(/^Plan written to /);
    const writtenPath = result.replace(/^Plan written to /, '');
    expect(existsSync(writtenPath)).toBe(true);
    expect(readFileSync(writtenPath, 'utf8')).toBe(planContent);
    expect(writtenPath.endsWith(`${sep}${sessionId}.md`)).toBe(true);
  });

  it('overwrites the plan file on subsequent calls (no history retained)', async () => {
    const sessionId = 'sess-002';
    const ctx = { projectPath: TEST_DIR, sessionId } as any;

    const firstResult = await runWithDefaultPlan(
      submitPlanTool.execute({ plan_content: 'first version' }, ctx)
    );
    const firstPath = firstResult.replace(/^Plan written to /, '');

    const secondResult = await runWithDefaultPlan(
      submitPlanTool.execute({ plan_content: 'second version' }, ctx)
    );
    const secondPath = secondResult.replace(/^Plan written to /, '');

    expect(secondPath).toBe(firstPath);
    expect(readFileSync(secondPath, 'utf8')).toBe('second version');
  });

  it('fails with TOOL_EXECUTION_FAILED when projectPath is missing from the tool context', async () => {
    const result = await Effect.runPromiseExit(
      submitPlanTool.execute({ plan_content: 'x' }, { sessionId: 's' } as any)
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') {
      const failureOption = Cause.failureOption(result.cause);
      expect(failureOption._tag).toBe('Some');
      if (failureOption._tag === 'Some') {
        const failure = failureOption.value as AgentError;
        expect(failure).toBeInstanceOf(AgentError);
        expect(failure.code).toBe('TOOL_EXECUTION_FAILED');
        expect(failure.message).toMatch(/projectPath and sessionId/);
      }
    }
  });

  it('fails with TOOL_EXECUTION_FAILED when sessionId is missing from the tool context', async () => {
    const result = await Effect.runPromiseExit(
      submitPlanTool.execute({ plan_content: 'x' }, { projectPath: TEST_DIR } as any)
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') {
      const failureOption = Cause.failureOption(result.cause);
      expect(failureOption._tag).toBe('Some');
      if (failureOption._tag === 'Some') {
        const failure = failureOption.value as AgentError;
        expect(failure).toBeInstanceOf(AgentError);
        expect(failure.code).toBe('TOOL_EXECUTION_FAILED');
      }
    }
  });
});
