import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { runPipeline } from '../../src/approval/pipeline.js';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import { READONLY_TOOL_NAMES } from '../../src/approval/presets.js';
import { HookService } from '../../src/hooks/registry.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { planApprovalHook } from '../../src/hooks/built-in/plan-approval.js';
import type { DecisionHandler } from '../../src/hooks/types.js';

const decisionHandlers: DecisionHandler[] = [];

const mockHookService = {
  register: () => Effect.succeed(() => {}),
  registerDecision: (_point: string, handler: DecisionHandler, _opts?: any) =>
    Effect.sync(() => {
      decisionHandlers.push(handler);
    }),
  emit: () => Effect.succeed(undefined),
  emitDecision: (point: string, payload: any) =>
    Effect.sync(() => {
      if (point === 'tool.approval.pre') {
        for (const h of decisionHandlers) {
          const result = h(payload);
          if (result) return result;
        }
      }
      return null;
    }),
  reloadUserHooks: () => Effect.succeed(undefined),
  attachSessionHooks: () => Effect.succeed(undefined),
  disableHook: () => Effect.succeed(undefined),
  enableHook: () => Effect.succeed(undefined),
  disposeSession: () => Effect.succeed(undefined),
  disposeProject: () => Effect.succeed(undefined),
};

// Capture the payload of emitApprovalRequest so we can verify the Layer 4 → Layer 5 handoff
let capturedApproval: any = null;

function makeMockApprovalWait() {
  return {
    // waitForConfirm returns a deny (we don't need a real user response — the
    // tests only care about the chain up to the user confirm).
    waitForConfirm: () => Effect.succeed({ type: 'deny' }) as any,
    resolveConfirm: () => Effect.succeed(false),
    getPending: () => Effect.succeed([]),
    emitApprovalRequest: (sessionId: string, id: string, tool: string, args: any, payload?: any) =>
      Effect.sync(() => {
        capturedApproval = { sessionId, id, tool, args, payload };
      }),
    registerEmitter: () => Effect.succeed(undefined),
    delegateEmitter: () => Effect.succeed(undefined),
    unregisterEmitter: () => Effect.succeed(undefined),
    // hasEmitter returns true so the pipeline proceeds to userConfirmAsync
    hasEmitter: () => Effect.succeed(true),
  };
}

function runPipelineWithMock(opts: {
  tool: string;
  input: any;
  permissionMode: 'plan' | 'default' | 'bypass' | 'acceptEdits';
  sessionId: string;
}) {
  capturedApproval = null;
  decisionHandlers.length = 0;
  decisionHandlers.push(planApprovalHook);
  const mockWait = makeMockApprovalWait();
  const HookTestLayer = Layer.succeed(HookService, mockHookService as any);
  const WaitTestLayer = Layer.succeed(ApprovalWaitService, mockWait as any);
  const TestLayer = Layer.mergeAll(HookTestLayer, WaitTestLayer);
  return Effect.runPromise(
    runPipeline(
      { tool: opts.tool, input: opts.input },
      {
        ruleEngine: createRuleEngine([]),
        readonlyTools: new Set(READONLY_TOOL_NAMES),
        destructiveTools: new Set(),
        permissionMode: opts.permissionMode,
        sessionId: opts.sessionId,
      }
    ).pipe(Effect.provide(TestLayer) as any)
  );
}

describe('Approval Pipeline — plan mode submit_plan (v13 改 2)', () => {
  it('Layer 3 returns null for submit_plan in plan mode (delegates to Layer 4/5)', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'submit_plan',
      input: { plan_content: '# My plan' },
      permissionMode: 'plan',
      sessionId: 's1',
    });
    // Layer 3 returns null. Layer 4 returns ask. Layer 5 calls emitApprovalRequest,
    // then waitForConfirm returns { type: 'deny' } from the mock. The switch
    // maps deny → { source: 'user-confirm' }.
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('user-confirm');
    // Crucially, the decision is NOT 'allow' with source 'permission-mode-plan-whitelist'
    // (which was the old buggy behavior where Layer 3 short-circuited).
    expect(decision.source).not.toBe('permission-mode-plan-whitelist');
  });

  it('Layer 4 planApprovalHook fires and propagates plan_content payload to Layer 5', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'submit_plan',
      input: { plan_content: '# Plan v1' },
      permissionMode: 'plan',
      sessionId: 's2',
    });
    // Layer 4 hook returned { decision: 'ask', payload: { plan_content, ... } }.
    // Layer 5 then called emitApprovalRequest with that payload.
    expect(capturedApproval).not.toBeNull();
    expect(capturedApproval.tool).toBe('submit_plan');
    expect(capturedApproval.args).toEqual({ plan_content: '# Plan v1' });
    expect(capturedApproval.payload).toBeDefined();
    expect(capturedApproval.payload.plan_content).toBe('# Plan v1');
    // Session and call id propagated
    expect(capturedApproval.sessionId).toBe('s2');
    expect(capturedApproval.id).toBeDefined();
    // Result is still deny (from waitForConfirm mock)
    expect(decision.type).toBe('deny');
  });

  it('Layer 3 still denies write_file in plan mode (other writes are blocked)', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'write_file',
      input: { path: '/tmp/x', content: 'foo' },
      permissionMode: 'plan',
      sessionId: 's3',
    });
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan mode/i);
    expect(decision.source).toBe('permission-mode');
  });

  it('Layer 3 still denies execute_command in plan mode', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'execute_command',
      input: { command: 'rm -rf /' },
      permissionMode: 'plan',
      sessionId: 's4',
    });
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan mode/i);
    expect(decision.source).toBe('permission-mode');
  });

  it('submit_plan in default mode: Layer 4 still fires (hook is universal for submit_plan)', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'submit_plan',
      input: { plan_content: '# plan' },
      permissionMode: 'default',
      sessionId: 's5',
    });
    // In default mode, Layer 3 returns null. Layer 4 (planApprovalHook) fires
    // and returns ask with payload. Layer 5 calls emitApprovalRequest.
    expect(capturedApproval).not.toBeNull();
    expect(capturedApproval.payload.plan_content).toBe('# plan');
    // Result is deny (from waitForConfirm mock)
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('user-confirm');
  });
});
