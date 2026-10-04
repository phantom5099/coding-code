import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { runPipeline } from '../../src/approval/approval.js';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import type { PermissionRule } from '../../src/approval/types.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { EventSinkService } from '../../src/sink/port.js';
import { HookService } from '../../src/hooks/port.js';

const mockHookService = {
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
};

const mockApprovalWaitService = {
  waitForConfirm: () => Effect.dieMessage('not implemented'),
  resolveConfirm: () => Effect.succeed(false),
  cancelPendingFor: () => Effect.succeed(0),
};

const mockEventSink = {
  attach: () => Effect.succeed({} as any),
  detach: () => Effect.void,
  emit: () => Effect.void,
  has: () => Effect.succeed(false),
};

const HookTestLayer = Layer.succeed(HookService, mockHookService);
const WaitTestLayer = Layer.succeed(ApprovalWaitService, mockApprovalWaitService);
const SinkTestLayer = Layer.succeed(EventSinkService, mockEventSink as any);
const TestLayer = Layer.mergeAll(HookTestLayer, WaitTestLayer, SinkTestLayer);

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(TestLayer)));
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
          permissionMode: 'ask',
          sessionId: 'test',
        }
      )
    );
    expect((decision as any).type).toBe('deny');
    expect((decision as any).source).toContain('rule:');
  });

  it('ask mode does NOT auto-allow read-only tools (no UI → system deny)', async () => {
    const decision = await runWithLayer(
      runPipeline(
        { tool: 'read_file', input: { path: '/safe/file.txt' } },
        {
          ruleEngine: createRuleEngine(),
          destructiveTools: new Set(),
          permissionMode: 'ask',
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
