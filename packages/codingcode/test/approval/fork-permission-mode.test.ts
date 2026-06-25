import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { ApprovalService } from '../../src/approval/index.js';
import { HookService } from '../../src/hooks/registry.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';

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

const TestLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.succeed(HookService, mockHookService as any)),
  Layer.provide(Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any))
);

let _service: ApprovalService | null = null;
async function getService(): Promise<ApprovalService> {
  if (!_service) {
    _service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ApprovalService;
      }).pipe(Effect.provide(TestLayer) as any)
    );
  }
  return _service!;
}

function run<T>(eff: (svc: ApprovalService) => Promise<T>): Promise<T> {
  return getService().then(eff);
}

describe('approval.fork({ permissionMode }) closure', () => {
  beforeEach(async () => {
    _service = null;
  });

  it('fork with permissionMode: bypass creates a child whose getPermissionMode returns bypass', async () => {
    const mode = await run(async (svc) => {
      const child = await Effect.runPromise(svc.fork({ permissionMode: 'bypass' }));
      return child.getPermissionMode();
    });
    expect(mode).toBe('bypass');
  });

  it('fork with permissionMode: acceptEdits creates a child with acceptEdits', async () => {
    const mode = await run(async (svc) => {
      const child = await Effect.runPromise(svc.fork({ permissionMode: 'acceptEdits' }));
      return child.getPermissionMode();
    });
    expect(mode).toBe('acceptEdits');
  });

  it('fork without permissionMode defaults to "default"', async () => {
    const mode = await run(async (svc) => {
      const child = await Effect.runPromise(svc.fork({}));
      return child.getPermissionMode();
    });
    expect(mode).toBe('default');
  });

  it('two forks with different permissionMode are isolated', async () => {
    const result = await run(async (svc) => {
      const a = await Effect.runPromise(svc.fork({ permissionMode: 'bypass' }));
      const b = await Effect.runPromise(svc.fork({ permissionMode: 'default' }));
      return { a: a.getPermissionMode(), b: b.getPermissionMode() };
    });
    expect(result.a).toBe('bypass');
    expect(result.b).toBe('default');
  });
});
