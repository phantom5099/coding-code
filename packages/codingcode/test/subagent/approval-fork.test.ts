import { expect, it, describe } from 'vitest';
import { Context, Effect, Layer } from 'effect';
import { ApprovalService } from '../../src/approval/port.js';
import { HookService } from '../../src/hooks/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { ApprovalLayer as ApprovalLayerImpl } from '../../src/approval/approval.js';

type ApprovalSvc = Context.Tag.Service<typeof ApprovalService>;

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

const ApprovalLayer = ApprovalLayerImpl.pipe(
  Layer.provide(Layer.succeed(HookService, mockHookService as any)),
  Layer.provide(Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any))
);

describe('ApprovalService.fork', () => {
  async function makeApproval(): Promise<ApprovalSvc> {
    return await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ApprovalService;
      }).pipe(Effect.provide(ApprovalLayer) as any)
    );
  }

  async function evaluateChild(
    opts: Parameters<ApprovalSvc['fork']>[0],
    tool: string,
    input: Record<string, unknown>
  ) {
    const parent = await makeApproval();
    const child = await Effect.runPromise(parent.fork(opts));
    return Effect.runPromise(child.evaluate({ tool, input, sessionId: 'test' }));
  }

  it('creates a forked approval service with evaluate and fork', async () => {
    const parent = await makeApproval();
    const child = await Effect.runPromise(parent.fork());
    expect(child).toBeDefined();
    expect(child.evaluate).toBeDefined();
    expect(child.fork).toBeDefined();
  });

  it('readonly fork denies destructive tools', async () => {
    const decision = await evaluateChild({ readonly: true }, 'execute_command', { command: 'echo hi' });
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('rule:readonly-execute_command');
  });

  it('extraDenyRules denies the matching tool', async () => {
    const decision = await evaluateChild(
      { extraDenyRules: [{ id: 'x', action: 'deny', toolPattern: 'custom_tool' }] },
      'custom_tool',
      {}
    );
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('rule:x');
  });

  it('nested fork inherits parent permission mode', async () => {
    const parent = await makeApproval();
    const child1 = await Effect.runPromise(parent.fork({ permissionMode: 'bypass' }));
    const child2 = await Effect.runPromise(child1.fork());
    const decision = await Effect.runPromise(
      child2.evaluate({ tool: 'read_file', input: { path: '/tmp/x' }, sessionId: 'test' })
    );
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('permission-mode');
  });

  it('combines readonly and extraDenyRules', async () => {
    const parent = await makeApproval();
    const child = await Effect.runPromise(
      parent.fork({
        readonly: true,
        extraDenyRules: [{ id: 'extra', action: 'deny', toolPattern: 'special_tool' }],
      })
    );
    const destructive = await Effect.runPromise(
      child.evaluate({ tool: 'execute_command', input: { command: 'echo hi' }, sessionId: 'test' })
    );
    const extra = await Effect.runPromise(
      child.evaluate({ tool: 'special_tool', input: {}, sessionId: 'test' })
    );
    expect(destructive.type).toBe('deny');
    expect(extra.type).toBe('deny');
  });
});
