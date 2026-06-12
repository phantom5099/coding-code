import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { ApprovalService } from '../../src/approval/index.js';

const TestLayer = ApprovalService.Default;

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(TestLayer) as any));
}

describe('Global permission mode state', () => {
  beforeEach(async () => {
    // Reset to default between tests
    await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalService;
        yield* svc.setPermissionMode('default');
      })
    );
  });

  it('starts as default', async () => {
    const mode = await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalService;
        return svc.getPermissionMode();
      })
    );
    expect(mode).toBe('default');
  });

  it('can be set to all valid modes', async () => {
    const modes = ['default', 'acceptEdits', 'plan', 'bypass'] as const;
    for (const mode of modes) {
      await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalService;
          yield* svc.setPermissionMode(mode);
        })
      );
      const current = await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalService;
          return svc.getPermissionMode();
        })
      );
      expect(current).toBe(mode);
    }
  });

  it('is shared across multiple reads (module-level singleton)', async () => {
    await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalService;
        yield* svc.setPermissionMode('plan');
      })
    );
    const mode1 = await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalService;
        return svc.getPermissionMode();
      })
    );
    const mode2 = await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalService;
        return svc.getPermissionMode();
      })
    );
    // Both reads return the same value — no per-call isolation
    expect(mode1).toBe('plan');
    expect(mode2).toBe('plan');
  });
});
