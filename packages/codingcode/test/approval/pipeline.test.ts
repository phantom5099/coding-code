import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { runPipeline } from '../../src/approval/pipeline.js';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import type { PermissionRule } from '../../src/approval/types.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { HookService } from '../../src/hooks/port.js';

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

describe('Approval Pipeline — PermissionMode auto-allow (merged from ReadonlyWhitelist + acceptEdits)', () => {
  it('Rule Engine deny short-circuits regardless of mode', async () => {
    const rules: PermissionRule[] = [
      { id: 'deny', action: 'deny', toolPattern: '*', argPattern: 'rm -rf *', reason: 'Blocked' },
    ];
    const decision = await runWithLayer(
      runPipeline(
        { tool: 'Bash', input: { command: 'rm -rf /var' } },
        {
          ruleEngine: createRuleEngine(rules),
          destructiveTools: new Set(),
          permissionMode: 'default',
          sessionId: 'test',
        }
      )
    );
    expect((decision as any).type).toBe('deny');
    expect((decision as any).source).toContain('rule:');
  });

  it('default mode does NOT auto-allow read-only tools (no UI → system deny)', async () => {
    const decision = await runWithLayer(
      runPipeline(
        { tool: 'read_file', input: { path: '/safe/file.txt' } },
        {
          ruleEngine: createRuleEngine(),
          destructiveTools: new Set(),
          permissionMode: 'default',
          sessionId: 'test',
        }
      )
    );
    expect((decision as any).type).toBe('deny');
    expect((decision as any).source).toBe('system');
    expect((decision as any).reason).toBe('Approval required but no UI available');
  });

  it('acceptEdits mode auto-allows read-only tools (read-only merged into non-destructive)', async () => {
    const decision = await runWithLayer(
      runPipeline(
        { tool: 'read_file', input: { path: '/safe/file.txt' } },
        {
          ruleEngine: createRuleEngine(),
          destructiveTools: new Set(['Bash', 'execute_command']),
          permissionMode: 'acceptEdits',
          sessionId: 'test',
        }
      )
    );
    expect((decision as any).type).toBe('allow');
    expect((decision as any).source).toBe('permission-mode');
  });
});
