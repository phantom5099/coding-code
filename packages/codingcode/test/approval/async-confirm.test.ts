import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { ApprovalWaitService } from '../../src/approval/async-confirm';
import type { ConfirmResult } from '../../src/approval/confirmation';

const TestLayer = ApprovalWaitService.Default;

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(TestLayer) as any));
}

describe('ApprovalWaitService', () => {
  it('should wait for and resolve a pending approval', async () => {
    const result = run(Effect.gen(function* () {
      const svc = yield* ApprovalWaitService;
      const id = 'test-1';

      // Fork waitForConfirm so it runs in background
      yield* Effect.fork(Effect.gen(function* () {
        yield* Effect.sleep('10 millis');
        yield* svc.resolveConfirm(id, 'test-session', { type: 'allow' });
      }));

      return yield* svc.waitForConfirm(id, 'test-session');
    }));

    await expect(result).resolves.toEqual({ type: 'allow' });
  });

  it('resolveConfirm should return false for unknown id', async () => {
    const result = await run(Effect.gen(function* () {
      const svc = yield* ApprovalWaitService;
      return yield* svc.resolveConfirm('nonexistent', 'test-session', { type: 'deny' });
    }));
    expect(result).toBe(false);
  });

  it('getPending should list pending approval ids', async () => {
    const result = await run(Effect.gen(function* () {
      const svc = yield* ApprovalWaitService;

      yield* Effect.fork(svc.waitForConfirm('pending-1', 'test-session'));
      yield* Effect.sleep('5 millis');

      return yield* svc.getPending();
    }));
    expect(result).toContain('pending-1');
  });
});
