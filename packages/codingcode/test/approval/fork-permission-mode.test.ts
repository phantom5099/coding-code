import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Layer, Context } from 'effect';
import { ApprovalService } from '../../src/approval/port.js';
import { HookService } from '../../src/hooks/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { ApprovalLayer } from '../../src/approval/approval.js';

type Approval = Context.Tag.Service<typeof ApprovalService>;

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

const TestLayer = ApprovalLayer.pipe(
  Layer.provide(Layer.succeed(HookService, mockHookService as any)),
  Layer.provide(Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any))
);

let _service: Approval | null = null;
async function getService(): Promise<Approval> {
  if (!_service) {
    _service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ApprovalService;
      }).pipe(Effect.provide(TestLayer) as any)
    );
  }
  return _service!;
}

function run<T>(eff: (svc: Approval) => Promise<T>): Promise<T> {
  return getService().then(eff);
}

function evaluateWithMode(mode: string, tool: string, input: Record<string, unknown>) {
  return run(async (svc) => {
    const child = await Effect.runPromise(svc.fork({ permissionMode: mode as any }));
    return Effect.runPromise(
      child.evaluate({ tool, input, sessionId: 'test' })
    );
  });
}

describe('approval.fork({ permissionMode }) applies the mode gate', () => {
  beforeEach(async () => {
    _service = null;
  });

  it('bypass auto-allows a non-destructive tool', async () => {
    const decision = await evaluateWithMode('bypass', 'read_file', { path: '/tmp/x' });
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('permission-mode');
  });

  it('acceptEdits auto-allows a non-destructive tool', async () => {
    const decision = await evaluateWithMode('acceptEdits', 'read_file', { path: '/tmp/x' });
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('permission-mode');
  });

  it('acceptEdits still gates a destructive tool', async () => {
    const decision = await evaluateWithMode('acceptEdits', 'execute_command', { command: 'echo hi' });
    expect(decision.type).toBe('deny');
  });

  it('fork without permissionMode defaults to "default" (requires confirmation)', async () => {
    const decision = await run(async (svc) => {
      const child = await Effect.runPromise(svc.fork({}));
      return Effect.runPromise(
        child.evaluate({ tool: 'read_file', input: { path: '/tmp/x' }, sessionId: 'test' })
      );
    });
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('system');
  });

  it('two forks with different modes are isolated', async () => {
    const result = await run(async (svc) => {
      const a = await Effect.runPromise(svc.fork({ permissionMode: 'bypass' }));
      const b = await Effect.runPromise(svc.fork({ permissionMode: 'default' }));
      const da = await Effect.runPromise(
        a.evaluate({ tool: 'read_file', input: { path: '/tmp/x' }, sessionId: 'test' })
      );
      const db = await Effect.runPromise(
        b.evaluate({ tool: 'read_file', input: { path: '/tmp/x' }, sessionId: 'test' })
      );
      return { a: da.type, b: db.type };
    });
    expect(result.a).toBe('allow');
    expect(result.b).toBe('deny');
  });
});
