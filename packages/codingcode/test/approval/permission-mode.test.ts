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

// Build the service once so state is shared across all run() calls
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

function run<T>(eff: (svc: ApprovalService) => Effect.Effect<T, any, any>): Promise<T> {
  return getService().then((svc) => Effect.runPromise(eff(svc) as any));
}

describe('Global permission mode state', () => {
  beforeEach(async () => {
    // Reset to default between tests
    await run((svc) => svc.setPermissionMode('default'));
  });

  it('starts as default', async () => {
    const mode = await run((svc) => Effect.succeed(svc.getPermissionMode()));
    expect(mode).toBe('default');
  });

  it('can be set to all valid modes', async () => {
    const modes = ['default', 'acceptEdits', 'plan', 'bypass'] as const;
    for (const mode of modes) {
      await run((svc) => svc.setPermissionMode(mode));
      const current = await run((svc) => Effect.succeed(svc.getPermissionMode()));
      expect(current).toBe(mode);
    }
  });

  it('is shared across multiple reads (module-level singleton)', async () => {
    await run((svc) => svc.setPermissionMode('plan'));
    const mode1 = await run((svc) => Effect.succeed(svc.getPermissionMode()));
    const mode2 = await run((svc) => Effect.succeed(svc.getPermissionMode()));
    // Both reads return the same value — no per-call isolation
    expect(mode1).toBe('plan');
    expect(mode2).toBe('plan');
  });
});
