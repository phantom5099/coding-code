import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { runPipeline } from '../../src/approval/pipeline.js';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import { READONLY_TOOL_NAMES } from '../../src/approval/presets.js';
import { HookService } from '../../src/hooks/registry.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { planApprovalHook } from '../../src/plan/hooks.js';
import { planModeGateHook } from '../../src/plan/gate.js';
import {
  markSessionPlanMode,
  clearPlanModeSession,
} from '../../src/plan/active-sessions.js';
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
    hasEmitter: () => Effect.succeed(true),
  };
}

function runPipelineWithMock(opts: {
  tool: string;
  input: any;
  permissionMode: 'default' | 'acceptEdits' | 'bypass';
  sessionId: string;
  planMode: boolean;
}) {
  capturedApproval = null;
  decisionHandlers.length = 0;
  decisionHandlers.push(planModeGateHook);
  decisionHandlers.push(planApprovalHook);

  if (opts.planMode) markSessionPlanMode(opts.sessionId, true);
  else markSessionPlanMode(opts.sessionId, false);

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

describe('Plan mode gate + approval hook integration', () => {
  beforeEach(() => {
    capturedApproval = null;
    decisionHandlers.length = 0;
  });

  it('plan mode + submit_plan: gate lets it through, planApprovalHook fires with payload', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'submit_plan',
      input: { plan_content: '# My plan' },
      permissionMode: 'default', // plan mode is now a side-channel flag, not PermissionMode
      sessionId: 's1',
      planMode: true,
    });
    expect(decision.type).toBe('deny'); // mock waitForConfirm returns deny
    expect(decision.source).toBe('user-confirm');
    expect(capturedApproval).not.toBeNull();
    expect(capturedApproval.tool).toBe('submit_plan');
    expect(capturedApproval.payload.plan_content).toBe('# My plan');
    expect(capturedApproval.sessionId).toBe('s1');

    clearPlanModeSession('s1');
  });

  it('plan mode + write_file: gate denies before reaching user confirmation', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'write_file',
      input: { path: '/tmp/x', content: 'foo' },
      permissionMode: 'default',
      sessionId: 's2',
      planMode: true,
    });
    // Gate denied, so no user confirmation fired.
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan mode/i);
    expect(capturedApproval).toBeNull();

    clearPlanModeSession('s2');
  });

  it('plan mode + execute_command: gate denies with plan-mode reason', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'execute_command',
      input: { command: 'rm -rf /' },
      permissionMode: 'default',
      sessionId: 's3',
      planMode: true,
    });
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan mode/i);
    expect(capturedApproval).toBeNull();

    clearPlanModeSession('s3');
  });

  it('plan mode + dispatch_agent: gate lets it through (subagent-whitelist hook handles further restriction at spawn time)', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'dispatch_agent',
      input: { agent: 'build', prompt: 'do something' },
      permissionMode: 'default',
      sessionId: 's4',
      planMode: true,
    });
    // The gate does not deny dispatch_agent (it's in PLAN_MODE_ALLOWED_TOOLS).
    // The pipeline may short-circuit at Layer 2 (readonly-whitelist) since
    // dispatch_agent is in READONLY_TOOL_NAMES. The subagent-whitelist hook
    // (a separate hook on agent.subagent.spawn.before) is what actually
    // restricts the dispatched profile to 'explore' — that runs later, when
    // the subagent is spawned, not at approval time.
    expect(decision.type).toBe('allow');
    expect(decision.type).not.toBe('deny');

    clearPlanModeSession('s4');
  });

  it('build mode + write_file: gate does not fire, pipeline falls through normally', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'write_file',
      input: { path: '/tmp/x', content: 'foo' },
      permissionMode: 'default',
      sessionId: 's5',
      planMode: false,
    });
    // build mode: write_file is not in any allowlist, pipeline reaches user confirm
    expect(capturedApproval).not.toBeNull();
    expect(decision.source).toBe('user-confirm');

    clearPlanModeSession('s5');
  });

  it('build mode + submit_plan: gate does not fire, planApprovalHook still produces ask+payload (universal trigger)', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'submit_plan',
      input: { plan_content: '# plan' },
      permissionMode: 'default',
      sessionId: 's6',
      planMode: false,
    });
    expect(capturedApproval).not.toBeNull();
    expect(capturedApproval.payload.plan_content).toBe('# plan');
    expect(decision.source).toBe('user-confirm');

    clearPlanModeSession('s6');
  });
});
