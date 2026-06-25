import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPipeline } from '../../src/approval/pipeline.js';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import { READONLY_TOOL_NAMES } from '../../src/approval/presets.js';
import { HookService } from '../../src/hooks/registry.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { planModeGateHook } from '../../src/plan/index.js';
import { computePaths } from '../../src/core/path.js';
import type { DecisionHandler } from '../../src/hooks/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

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

let capturedApproval: any = null;

function makeMockApprovalWait() {
  return {
    waitForConfirm: () => Effect.succeed({ type: 'deny' }) as any,
    resolveConfirm: () => Effect.succeed(false),
    getPending: () => Effect.succeed([]),
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

function makeIndex(cwd: string, sessionId: string, mode: 'plan' | 'build') {
  const paths = computePaths(cwd, sessionId);
  mkdirSync(paths.transcriptPath.replace(/\.jsonl$/, ''), { recursive: true });
  const idx = {
    sessionId,
    projectPath: paths.projectPath,
    cwd: paths.cwd,
    model: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    title: sessionId.slice(0, 8),
    currentTurnId: 0,
    usage: undefined,
    mode,
    permissionMode: 'default',
  };
  writeFileSync(paths.indexPath, JSON.stringify(idx, null, 2), 'utf8');
}

function runPipelineWithMock(opts: {
  tool: string;
  input: any;
  permissionMode: 'default' | 'acceptEdits' | 'bypass';
  sessionId: string;
  planMode: boolean;
  cwd: string;
}) {
  capturedApproval = null;
  decisionHandlers.length = 0;
  decisionHandlers.push(planModeGateHook);

  if (opts.planMode) makeIndex(opts.cwd, opts.sessionId, 'plan');
  else makeIndex(opts.cwd, opts.sessionId, 'build');

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
        projectPath: opts.cwd,
      }
    ).pipe(Effect.provide(TestLayer) as any)
  );
}

describe('Plan mode gate hook integration', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-gate-pipeline-'));
    capturedApproval = null;
    decisionHandlers.length = 0;
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('plan mode + write_file: gate denies before reaching user confirmation', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'write_file',
      input: { path: '/tmp/x', content: 'foo' },
      permissionMode: 'default',
      sessionId: 's2',
      planMode: true,
      cwd,
    });
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan mode/i);
    expect(capturedApproval).toBeNull();
  });

  it('plan mode + execute_command: gate denies with plan-mode reason', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'execute_command',
      input: { command: 'rm -rf /' },
      permissionMode: 'default',
      sessionId: 's3',
      planMode: true,
      cwd,
    });
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan mode/i);
    expect(capturedApproval).toBeNull();
  });

  it('plan mode + dispatch_agent: gate lets it through', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'dispatch_agent',
      input: { agent: 'build', prompt: 'do something' },
      permissionMode: 'default',
      sessionId: 's4',
      planMode: true,
      cwd,
    });
    expect(decision.type).toBe('allow');
    expect(decision.type).not.toBe('deny');
  });

  it('build mode + write_file: gate does not fire, pipeline falls through normally', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'write_file',
      input: { path: '/tmp/x', content: 'foo' },
      permissionMode: 'default',
      sessionId: 's5',
      planMode: false,
      cwd,
    });
    expect(capturedApproval).not.toBeNull();
    expect(decision.source).toBe('user-confirm');
  });

  it('submit_plan: pipeline short-circuits at Layer 5', async () => {
    const decision: any = await runPipelineWithMock({
      tool: 'submit_plan',
      input: { plan_content: '# plan' },
      permissionMode: 'default',
      sessionId: 's6',
      planMode: true,
      cwd,
    });
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('system-plan-self-handles');
    expect(capturedApproval).toBeNull();
  });
});
