import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPipeline } from '../../src/approval/pipeline.js';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import { HookService } from '../../src/hooks/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import type { ApprovalProfile } from '../../src/approval/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

const mockHookService = {
  register: () => Effect.succeed(() => {}),
  registerDecision: () => Effect.succeed(() => {}),
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
  attachSessionHooks: () => Effect.succeed(undefined),
  disableHook: () => Effect.succeed(undefined),
  enableHook: () => Effect.succeed(undefined),
  disposeSession: () => Effect.succeed(undefined),
  disposeProject: () => Effect.succeed(undefined),
};

let capturedApproval: any = null;

function makeMockApprovalWait() {
  return {
    waitForConfirm: () => Effect.succeed({ type: 'deny' }) as any,
    resolveConfirm: () => Effect.succeed(false),
    emitApprovalRequest: (sessionId: string, id: string, tool: string, args: any) =>
      Effect.sync(() => {
        capturedApproval = { sessionId, id, tool, args };
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
  profile: ApprovalProfile;
}) {
  capturedApproval = null;

  const mockWait = makeMockApprovalWait();
  const HookTestLayer = Layer.succeed(HookService, mockHookService as any);
  const WaitTestLayer = Layer.succeed(ApprovalWaitService, mockWait as any);
  const TestLayer = Layer.mergeAll(HookTestLayer, WaitTestLayer);
  return Effect.runPromise(
    runPipeline(
      { tool: opts.tool, input: opts.input },
      {
        ruleEngine: createRuleEngine([]),
        destructiveTools: new Set(),
        permissionMode: opts.permissionMode,
        profile: opts.profile,
        sessionId: opts.sessionId,
      }
    ).pipe(Effect.provide(TestLayer) as any)
  );
}

describe('plan profile permission mode (Layer 2)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-gate-pipeline-'));
    capturedApproval = null;
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('plan profile + write_file: denied before reaching user confirmation', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'write_file',
      input: { path: '/tmp/x', content: 'foo' },
      permissionMode: 'default',
      sessionId: 's2',
      profile: 'plan',
    });
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('permission-mode');
    expect(decision.reason).toMatch(/plan profile/i);
    expect(capturedApproval).toBeNull();
  });

  it('plan profile + execute_command: denied with plan-profile reason', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'execute_command',
      input: { command: 'rm -rf /' },
      permissionMode: 'default',
      sessionId: 's3',
      profile: 'plan',
    });
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('permission-mode');
    expect(decision.reason).toMatch(/plan profile/i);
    expect(capturedApproval).toBeNull();
  });

  it('plan profile + dispatch_agent: denied by plan mode', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'dispatch_agent',
      input: { agent: 'build', prompt: 'do something' },
      permissionMode: 'default',
      sessionId: 's4',
      profile: 'plan',
    });
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('permission-mode');
    expect(decision.reason).toMatch(/plan profile/i);
    expect(capturedApproval).toBeNull();
  });

  it('build profile + write_file: falls through to user confirmation', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'write_file',
      input: { path: '/tmp/x', content: 'foo' },
      permissionMode: 'default',
      sessionId: 's5',
      profile: 'build',
    });
    expect(capturedApproval).not.toBeNull();
    expect(decision.source).toBe('user-confirm');
  });

  it('plan profile + submit_plan: allowed by plan allow-list', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'submit_plan',
      input: { plan_content: '# plan' },
      permissionMode: 'default',
      sessionId: 's6',
      profile: 'plan',
    });
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('permission-mode');
    expect(capturedApproval).toBeNull();
  });
});
