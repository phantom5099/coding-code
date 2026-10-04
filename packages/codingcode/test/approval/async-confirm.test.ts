import { describe, it, expect } from 'vitest';
import { Effect, Fiber, Layer } from 'effect';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import type { ConfirmResult } from '../../src/approval/confirmation.js';
import { ApprovalWaitLayer } from '../../src/approval/wait.js';

const TestLayer = ApprovalWaitLayer;

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(TestLayer) as any));
}

describe('ApprovalWaitService', () => {
  it('should wait for and resolve a pending approval', async () => {
    const result = run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        const id = 'test-1';

        // Fork waitForConfirm so it runs in background
        yield* Effect.fork(
          Effect.gen(function* () {
            yield* Effect.sleep('10 millis');
            yield* svc.resolveConfirm(id, 'test-session', { type: 'allow' });
          })
        );

        return yield* svc.waitForConfirm(id, 'test-session');
      })
    );

    await expect(result).resolves.toEqual({ type: 'allow' });
  });

  it('resolveConfirm should return false for unknown id', async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        return yield* svc.resolveConfirm('nonexistent', 'test-session', { type: 'deny' });
      })
    );
    expect(result).toBe(false);
  });

  it('resolveConfirm returns false when sessionId does not match stored sessionId', async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        const id = 'cross-session-id';

        // register a pending approval under the child session id
        yield* Effect.fork(svc.waitForConfirm(id, 'child-session-uuid'));
        yield* Effect.sleep('5 millis');

        // resolving with a different session id must fail (no cross-session resolve)
        return yield* svc.resolveConfirm(id, 'parent-session', { type: 'allow' });
      })
    );
    expect(result).toBe(false);
  });
});

describe('cancelPendingFor', () => {
  it('fails pending approvals of that session closed as deny and returns the count', async () => {
    const sid = 'sess-' + Math.random().toString(36).slice(2);
    const other = 'other-' + Math.random().toString(36).slice(2);

    const results = await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        const mine = yield* Effect.fork(svc.waitForConfirm('a1', sid));
        const alsoMine = yield* Effect.fork(svc.waitForConfirm('a2', sid));
        const theirs = yield* Effect.fork(svc.waitForConfirm('b1', other));
        yield* Effect.sleep('5 millis');

        const cleared = yield* svc.cancelPendingFor(sid);
        const mineRes = yield* Fiber.join(mine);
        const alsoMineRes = yield* Fiber.join(alsoMine);
        // 其它会话的待决项不受影响
        const stillPending = yield* svc.resolveConfirm('b1', other, { type: 'allow' });
        yield* Fiber.join(theirs);
        return { cleared, mineRes, alsoMineRes, stillPending };
      })
    );

    expect(results.cleared).toBe(2);
    expect(results.mineRes).toEqual({ type: 'deny' });
    expect(results.alsoMineRes).toEqual({ type: 'deny' });
    expect(results.stillPending).toBe(true);
  });

  it('returns 0 when the session has no pending approvals', async () => {
    const cleared = await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        return yield* svc.cancelPendingFor('nobody');
      })
    );
    expect(cleared).toBe(0);
  });
});
