import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PlanApprovalService } from '../../src/plan/approval-service.js';
import { submitPlanTool } from '../../src/tools/domains/subagent/submit-plan.js';

const TEST_DIR = join(tmpdir(), 'codingcode-test-submit-plan-flow');

describe('submitPlanTool — plan approval flow (3-option modal)', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('writes the plan file when the user implements (allow)', async () => {
    const mockPlan = {
      requestPlanDecision: () => Effect.succeed({ type: 'allow' as const }) as any,
      resolvePlanDecision: () => Effect.succeed(false),
      getPending: () => Effect.succeed([]),
      registerEmitter: () => Effect.succeed(undefined),
      unregisterEmitter: () => Effect.succeed(undefined),
      hasEmitter: () => Effect.succeed(false),
    };
    const PlanLayer = Layer.succeed(PlanApprovalService, mockPlan as any);

    const sessionId = 'flow-sess-1';
    const result = await Effect.runPromise(
      submitPlanTool
        .execute({ plan_content: '# flow plan' }, { projectPath: TEST_DIR, sessionId } as any)
        .pipe(Effect.provide(PlanLayer))
    );

    expect(result).toMatch(/^Plan written to /);
    const writtenPath = result.replace(/^Plan written to /, '');
    expect(existsSync(writtenPath)).toBe(true);
    expect(readFileSync(writtenPath, 'utf8')).toBe('# flow plan');
  });

  it('writes the user-modified content when the user picks Modify', async () => {
    const mockPlan = {
      requestPlanDecision: () =>
        Effect.succeed({
          type: 'modified' as const,
          input: { plan_content: '# revised plan' },
        }) as any,
      resolvePlanDecision: () => Effect.succeed(false),
      getPending: () => Effect.succeed([]),
      registerEmitter: () => Effect.succeed(undefined),
      unregisterEmitter: () => Effect.succeed(undefined),
      hasEmitter: () => Effect.succeed(false),
    };
    const PlanLayer = Layer.succeed(PlanApprovalService, mockPlan as any);

    const sessionId = 'flow-sess-2';
    const result = await Effect.runPromise(
      submitPlanTool
        .execute(
          { plan_content: '# original plan' },
          { projectPath: TEST_DIR, sessionId } as any
        )
        .pipe(Effect.provide(PlanLayer))
    );

    expect(result).toMatch(/^Plan written to /);
    const writtenPath = result.replace(/^Plan written to /, '');
    expect(readFileSync(writtenPath, 'utf8')).toBe('# revised plan');
  });

  it('fails with TOOL_NOT_ALLOWED when the user cancels', async () => {
    const mockPlan = {
      requestPlanDecision: () => Effect.succeed({ type: 'canceled' as const }) as any,
      resolvePlanDecision: () => Effect.succeed(false),
      getPending: () => Effect.succeed([]),
      registerEmitter: () => Effect.succeed(undefined),
      unregisterEmitter: () => Effect.succeed(undefined),
      hasEmitter: () => Effect.succeed(false),
    };
    const PlanLayer = Layer.succeed(PlanApprovalService, mockPlan as any);

    const sessionId = 'flow-sess-3';
    const result = await Effect.runPromiseExit(
      submitPlanTool
        .execute({ plan_content: '# nope' }, { projectPath: TEST_DIR, sessionId } as any)
        .pipe(Effect.provide(PlanLayer))
    );

    expect(result._tag).toBe('Failure');
  });

  it('emits the plan metadata via emitter so the UI can render the 3-option modal', async () => {
    let captured: { args: any; payload: any; tool: any } | null = null;
    const mockPlan = {
      requestPlanDecision: (
        req: any,
        _sessionId: any,
        _id: any,
        _tool: any,
        args: any,
        payload: any
      ) => {
        captured = { args, payload, tool: 'submit_plan' };
        return Effect.succeed({ type: 'allow' as const }) as any;
      },
      resolvePlanDecision: () => Effect.succeed(false),
      getPending: () => Effect.succeed([]),
      registerEmitter: (
        _sessionId: string,
        fn: (id: string, tool: string, args: any, payload: any) => void
      ) =>
        Effect.sync(() => {
          fn('plan_test-id', 'submit_plan', { plan_content: '# capture me' }, {
            kind: 'plan',
            planPath: 'C:/x/test.md',
            projectPath: TEST_DIR,
            sessionId: 'flow-sess-4',
          });
        }),
      unregisterEmitter: () => Effect.succeed(undefined),
      hasEmitter: () => Effect.succeed(false),
    };
    const PlanLayer = Layer.succeed(PlanApprovalService, mockPlan as any);

    const sessionId = 'flow-sess-4';
    const planContent = '# capture me';
    await Effect.runPromise(
      submitPlanTool
        .execute({ plan_content: planContent }, { projectPath: TEST_DIR, sessionId } as any)
        .pipe(Effect.provide(PlanLayer))
    );

    expect(captured).not.toBeNull();
  });

  it('falls back to original content if Modified result is missing plan_content', async () => {
    const mockPlan = {
      requestPlanDecision: () =>
        Effect.succeed({
          type: 'modified' as const,
          input: {},
        }) as any,
      resolvePlanDecision: () => Effect.succeed(false),
      getPending: () => Effect.succeed([]),
      registerEmitter: () => Effect.succeed(undefined),
      unregisterEmitter: () => Effect.succeed(undefined),
      hasEmitter: () => Effect.succeed(false),
    };
    const PlanLayer = Layer.succeed(PlanApprovalService, mockPlan as any);

    const sessionId = 'flow-sess-5';
    const original = '# original';
    const result = await Effect.runPromise(
      submitPlanTool
        .execute({ plan_content: original }, { projectPath: TEST_DIR, sessionId } as any)
        .pipe(Effect.provide(PlanLayer))
    );

    const writtenPath = result.replace(/^Plan written to /, '');
    expect(readFileSync(writtenPath, 'utf8')).toBe(original);
  });
});
