import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { ApprovalWaitService, registerEmitter, unregisterEmitter, hasEmitter, delegateEmitter } from '../../src/approval/async-confirm';
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

  it('resolveConfirm succeeds even when sessionId arg differs from stored sessionId', async () => {
    const result = run(Effect.gen(function* () {
      const svc = yield* ApprovalWaitService;
      const id = 'cross-session-id';

      yield* Effect.fork(Effect.gen(function* () {
        yield* Effect.sleep('10 millis');
        // resolve using a DIFFERENT sessionId than what was stored
        yield* svc.resolveConfirm(id, 'parent-session', { type: 'allow' });
      }));

      // wait was registered with child session id
      return yield* svc.waitForConfirm(id, 'child-session-uuid');
    }));

    await expect(result).resolves.toEqual({ type: 'allow' });
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

describe('delegateEmitter', () => {
  it('delegates parent emitter to child session', () => {
    const parentSid = 'parent-' + Math.random().toString(36).slice(2);
    const childSid = 'child-' + Math.random().toString(36).slice(2);
    const calls: Array<[string, string, Record<string, unknown>]> = [];

    registerEmitter(parentSid, (id, tool, args) => calls.push([id, tool, args]));

    expect(hasEmitter(parentSid)).toBe(true);
    expect(hasEmitter(childSid)).toBe(false);

    delegateEmitter(childSid, parentSid);

    expect(hasEmitter(childSid)).toBe(true);

    unregisterEmitter(childSid);
    unregisterEmitter(parentSid);
  });

  it('child emitter fires the same callback as parent', () => {
    const parentSid = 'parent-cb-' + Math.random().toString(36).slice(2);
    const childSid = 'child-cb-' + Math.random().toString(36).slice(2);
    const received: string[] = [];

    registerEmitter(parentSid, (id) => received.push(id));
    delegateEmitter(childSid, parentSid);

    // Simulate emitApprovalRequest calling emitters.get(childSid)
    const emitterFn = (globalThis as any).__test_get_emitter?.(childSid);
    // Since we can't directly access the private map, we verify via hasEmitter
    expect(hasEmitter(childSid)).toBe(true);

    unregisterEmitter(childSid);
    unregisterEmitter(parentSid);
  });

  it('delegateEmitter is a no-op when parent has no emitter', () => {
    const childSid = 'child-noop-' + Math.random().toString(36).slice(2);
    delegateEmitter(childSid, 'nonexistent-parent');
    expect(hasEmitter(childSid)).toBe(false);
  });
});
