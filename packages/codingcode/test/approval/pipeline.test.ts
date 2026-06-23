import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { runPipeline } from '../../src/approval/pipeline.js';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import type { PermissionRule, ApprovalDecision } from '../../src/approval/types.js';
import { READONLY_TOOL_NAMES } from '../../src/approval/presets.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { HookService } from '../../src/hooks/registry.js';

const readonlyTools = new Set(READONLY_TOOL_NAMES);

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

const mockApprovalWaitService = {
  waitForConfirm: () => Effect.dieMessage('not implemented'),
  resolveConfirm: () => Effect.succeed(false),
  getPending: () => Effect.succeed([]),
  emitApprovalRequest: () => Effect.succeed(undefined),
  registerEmitter: () => Effect.succeed(undefined),
  delegateEmitter: () => Effect.succeed(undefined),
  unregisterEmitter: () => Effect.succeed(undefined),
  hasEmitter: () => Effect.succeed(false),
};

const HookTestLayer = Layer.succeed(HookService, mockHookService as any);
const WaitTestLayer = Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any);
const TestLayer = Layer.mergeAll(HookTestLayer, WaitTestLayer);

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(TestLayer) as any));
}

describe('Approval Pipeline', () => {
  it('Layer 1: Rule Engine deny should short-circuit', async () => {
    const rules: PermissionRule[] = [
      { id: 'deny', action: 'deny', toolPattern: '*', argPattern: 'rm -rf *', reason: 'Blocked' },
    ];
    const decision = await runWithLayer(
      runPipeline(
        { tool: 'Bash', input: { command: 'rm -rf /var' } },
        {
          ruleEngine: createRuleEngine(rules),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(),
          permissionMode: 'default',
          sessionId: 'test',
        }
      )
    );
    expect((decision as any).type).toBe('deny');
    expect((decision as any).source).toContain('rule:');
  });

  it('Layer 2: Read-only whitelist should auto-allow', async () => {
    const decision = await runWithLayer(
      runPipeline(
        { tool: 'read_file', input: { path: '/safe/file.txt' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(),
          permissionMode: 'default',
          sessionId: 'test',
        }
      )
    );
    expect((decision as any).type).toBe('allow');
    expect((decision as any).source).toBe('readonly-whitelist');
  });

  it('Layer 3: Bypass mode should allow everything', async () => {
    const decision = await runWithLayer(
      runPipeline(
        { tool: 'Bash', input: { command: 'rm -rf /' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash']),
          permissionMode: 'bypass',
          sessionId: 'test',
        }
      )
    );
    expect((decision as any).type).toBe('allow');
    expect((decision as any).source).toBe('permission-mode');
  });

  it('Layer 3: AcceptEdits mode should auto-allow non-destructive tools', async () => {
    const decision = await runWithLayer(
      runPipeline(
        { tool: 'write_file', input: { path: '/test.txt' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash', 'execute_command']),
          permissionMode: 'acceptEdits',
          sessionId: 'test',
        }
      )
    );
    expect((decision as any).type).toBe('allow');
  });

  it('Layer 3: AcceptEdits should NOT auto-allow destructive tools', async () => {
    const decision = await runWithLayer(
      runPipeline(
        { tool: 'Bash', input: { command: 'rm file' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash', 'execute_command']),
          permissionMode: 'acceptEdits',
          sessionId: 'test',
        }
      )
    );
    // Destructive tool in acceptEdits mode with no UI available → system deny
    expect((decision as any).type).toBe('deny');
    expect((decision as any).source).toBe('system');
  });

  it('Layer 4: PreToolUse hook can deny (non-readonly tool)', async () => {
    const hooksWithDeny = {
      ...mockHookService,
      emitDecision: () => Effect.succeed({ decision: 'deny' as const, reason: 'Hook denied' }),
    };
    const layer = Layer.mergeAll(Layer.succeed(HookService, hooksWithDeny as any), WaitTestLayer);
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'Bash', input: { command: 'ls' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash']),
          permissionMode: 'default',
          sessionId: 'test',
        }
      ).pipe(Effect.provide(layer) as any)
    );
    expect((decision as any).type).toBe('deny');
    expect((decision as any).source).toBe('hook');
  });

  it('Layer 4: PreToolUse hook can allow (skiping user confirmation)', async () => {
    const hooksWithAllow = {
      ...mockHookService,
      emitDecision: () => Effect.succeed({ decision: 'allow' as const }),
    };
    const layer = Layer.mergeAll(Layer.succeed(HookService, hooksWithAllow as any), WaitTestLayer);
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'Bash', input: { command: 'ls' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash']),
          permissionMode: 'default',
          sessionId: 'test',
        }
      ).pipe(Effect.provide(layer) as any)
    );
    expect((decision as any).type).toBe('allow');
    expect((decision as any).source).toBe('hook');
  });

  it('Layer 6: Audit log is recorded for every decision', async () => {
    let auditPayload: any = null;
    const hooksWithAudit = {
      ...mockHookService,
      emit: (_point: string, payload: Record<string, unknown>) =>
        Effect.sync(() => {
          auditPayload = payload;
        }),
    };
    const layer = Layer.mergeAll(Layer.succeed(HookService, hooksWithAudit as any), WaitTestLayer);
    await Effect.runPromise(
      runPipeline(
        { tool: 'read_file', input: { path: '/test.txt' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(),
          permissionMode: 'default',
          sessionId: 'test',
        }
      ).pipe(Effect.provide(layer) as any)
    );
    expect(auditPayload).not.toBeNull();
    expect(auditPayload.tool).toBe('read_file');
    expect(auditPayload.layers).toContain('AuditLog');
    expect((auditPayload.decision as any).type).toBe('allow');
  });
});
