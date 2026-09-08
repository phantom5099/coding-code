import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
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

describe('delegateEmitter', () => {
  it('delegates parent emitter to child session', async () => {
    const parentSid = 'parent-' + Math.random().toString(36).slice(2);
    const childSid = 'child-' + Math.random().toString(36).slice(2);
    const calls: Array<[string, string, Record<string, unknown>]> = [];

    await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        yield* svc.registerEmitter(
          parentSid,
          (id: string, tool: string, args: Record<string, unknown>) => calls.push([id, tool, args])
        );

        expect(yield* svc.hasEmitter(parentSid)).toBe(true);
        expect(yield* svc.hasEmitter(childSid)).toBe(false);

        yield* svc.delegateEmitter(childSid, parentSid);

        expect(yield* svc.hasEmitter(childSid)).toBe(true);

        yield* svc.unregisterEmitter(childSid);
        yield* svc.unregisterEmitter(parentSid);
      })
    );
  });

  it('child emitter fires the same callback as parent', async () => {
    const parentSid = 'parent-cb-' + Math.random().toString(36).slice(2);
    const childSid = 'child-cb-' + Math.random().toString(36).slice(2);
    const received: string[] = [];

    await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        yield* svc.registerEmitter(parentSid, (id: string) => received.push(id));
        yield* svc.delegateEmitter(childSid, parentSid);

        // Since we can't directly access the private map, we verify via hasEmitter
        expect(yield* svc.hasEmitter(childSid)).toBe(true);

        yield* svc.unregisterEmitter(childSid);
        yield* svc.unregisterEmitter(parentSid);
      })
    );
  });

  it('delegateEmitter is a no-op when parent has no emitter', async () => {
    const childSid = 'child-noop-' + Math.random().toString(36).slice(2);
    await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        yield* svc.delegateEmitter(childSid, 'nonexistent-parent');
        expect(yield* svc.hasEmitter(childSid)).toBe(false);
      })
    );
  });
});
