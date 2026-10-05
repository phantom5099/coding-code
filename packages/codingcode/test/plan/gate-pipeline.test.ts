import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPipeline } from '../../src/approval/approval.js';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import { HookService } from '../../src/hooks/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { EventSinkService } from '../../src/sink/port.js';
import type { ProfileName } from '../../src/contracts/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

const mockHookService = {
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
};

let capturedApproval: any = null;

function makeMockApprovalWait() {
  return {
    waitForConfirm: () => Effect.succeed({ type: 'deny' }) as any,
    resolveConfirm: () => Effect.succeed(false),
    cancelPendingFor: () => Effect.succeed(0),
  };
}

// 审批请求现在经 EventSink 出站，捕获点从 wait 的 emitter 迁到 sink.emit
function makeMockEventSink() {
  return {
    attach: () => Effect.succeed({} as any),
    detach: () => Effect.void,
    emit: (sessionId: string, body: any) =>
      Effect.sync(() => {
        if (body?.family === 'event' && body.event?.type === 'approval_request') {
          capturedApproval = { sessionId, id: body.event.id, tool: body.event.tool, args: body.event.args };
        }
      }),
  };
}

function runPipelineWithMock(opts: {
  tool: string;
  input: any;
  permissionMode: 'askBeforeExec' | 'bypass';
  sessionId: string;
  profile: ProfileName;
}) {
  capturedApproval = null;

  const mockWait = makeMockApprovalWait();
  const HookTestLayer = Layer.succeed(HookService, mockHookService as any);
  const WaitTestLayer = Layer.succeed(ApprovalWaitService, mockWait as any);
  const SinkTestLayer = Layer.succeed(EventSinkService, makeMockEventSink() as any);
  const TestLayer = Layer.mergeAll(HookTestLayer, WaitTestLayer, SinkTestLayer);
  return Effect.runPromise(
    runPipeline(
      { tool: opts.tool, input: opts.input },
      {
        ruleEngine: createRuleEngine([]),
        destructiveTools: new Set(['execute_command']),
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
      permissionMode: 'askBeforeExec',
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
      permissionMode: 'askBeforeExec',
      sessionId: 's3',
      profile: 'plan',
    });
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('permission-mode');
    expect(decision.reason).toMatch(/plan profile/i);
    expect(capturedApproval).toBeNull();
  });

  it('plan profile + spawn_agent: denied by plan mode', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'spawn_agent',
      input: { agentName: 'build', prompt: 'do something' },
      permissionMode: 'askBeforeExec',
      sessionId: 's4',
      profile: 'plan',
    });
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('permission-mode');
    expect(decision.reason).toMatch(/plan profile/i);
    expect(capturedApproval).toBeNull();
  });

  it('build profile + write_file: auto-allowed, never reaches confirmation', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'write_file',
      input: { path: '/tmp/x', content: 'foo' },
      permissionMode: 'askBeforeExec',
      sessionId: 's5',
      profile: 'build',
    });
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('permission-mode');
    expect(capturedApproval).toBeNull();
  });

  it('build profile + execute_command: falls through to user confirmation', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'execute_command',
      input: { command: 'ls' },
      permissionMode: 'askBeforeExec',
      sessionId: 's7',
      profile: 'build',
    });
    expect(capturedApproval).not.toBeNull();
    expect(decision.source).toBe('user-confirm');
  });

  it('plan profile + submit_plan: allowed by plan allow-list', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'submit_plan',
      input: { plan_content: '# plan' },
      permissionMode: 'askBeforeExec',
      sessionId: 's6',
      profile: 'plan',
    });
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('permission-mode');
    expect(capturedApproval).toBeNull();
  });
});
