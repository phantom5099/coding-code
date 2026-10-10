import { describe, it, expect } from 'vitest';
import { Effect, Layer, Queue } from 'effect';
import { TurnRegistryLayer } from '../../src/turn/registry.js';
import { TurnRegistryService } from '../../src/turn/port.js';
import type { PendingUserInput, TurnCommand } from '../../src/turn/types.js';
import { EventSinkService } from '../../src/sink/port.js';
import type { FrameBody } from '../../src/sink/types.js';
import { textPart } from '../../src/llm/types.js';

function makeHarness() {
  const emitted: Array<{ sessionId: string; body: FrameBody }> = [];
  const sink = Layer.succeed(EventSinkService, {
    attach: () => Effect.succeed(Effect.runSync(Queue.unbounded<FrameBody>())),
    detach: () => Effect.void,
    emit: (sessionId: string, body: FrameBody) =>
      Effect.sync(() => {
        emitted.push({ sessionId, body });
      }),
  } as any);
  const layers = TurnRegistryLayer.pipe(Layer.provide(sink));
  /** 投给某会话的帧序列投影 */
  const framesFor = (sessionId: string) =>
    emitted.filter((e) => e.sessionId === sessionId).map((e) => e.body);
  return { emitted, layers, framesFor };
}

const run = <T>(layers: Layer.Layer<any>, eff: Effect.Effect<T, any, any>): Promise<T> =>
  Effect.runPromise(eff.pipe(Effect.provide(layers)) as unknown as Effect.Effect<T, never, never>);

const input = (id: string): PendingUserInput => ({ id, parts: [textPart('hi')] });

describe('turn registry', () => {
  it('claim 在已有 running 记录时返回 false 且不覆盖 turnId', async () => {
    const { layers } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        const first = yield* t.claim('s1', { turnId: 1 });
        const second = yield* t.claim('s1', { turnId: 2 });
        return { first, second };
      })
    );
    expect(result.first).toBe(true);
    expect(result.second).toBe(false);
  });

  it('记录终态后 claim 成功并换成新 turnId', async () => {
    const { layers, framesFor } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        yield* t.claim('s1', { turnId: 1 });
        yield* t.transition('s1', { kind: 'complete', reason: 'done' });
        const re = yield* t.claim('s1', { turnId: 5 });
        yield* t.transition('s1', { kind: 'start' });
        return re;
      })
    );
    expect(result).toBe(true);
    // 新回合的 start 帧带新 turnId
    const start = framesFor('s1').find(
      (f) => f.family === 'transition' && f.transition.to === 'start'
    ) as any;
    expect(start.transition.turnId).toBe(5);
  });

  it('submit 无记录 / 终态记录返回 no-active-turn，running 时返回 attached 且 parts 原样', async () => {
    const { layers } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        const none = yield* t.submit('s1', input('a'));
        yield* t.claim('s1', { turnId: 7 });
        const attached = yield* t.submit('s1', input('b'));
        const drained = yield* t.drain('s1');
        yield* t.transition('s1', { kind: 'complete', reason: 'done' });
        const afterEnd = yield* t.submit('s1', input('c'));
        return { none, attached, drained, afterEnd };
      })
    );
    expect(result.none.kind).toBe('no-active-turn');
    expect(result.attached).toEqual({ kind: 'attached', turnId: 7 });
    expect(result.drained.map((d) => d.id)).toEqual(['b']);
    expect(result.afterEnd.kind).toBe('no-active-turn');
  });

  it('drain 取走后槽为空（第二次返回空数组）', async () => {
    const { layers } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        yield* t.claim('s1', { turnId: 1 });
        yield* t.submit('s1', input('a'));
        const first = yield* t.drain('s1');
        const second = yield* t.drain('s1');
        return { first: first.length, second: second.length };
      })
    );
    expect(result.first).toBe(1);
    expect(result.second).toBe(0);
  });

  it.each<TurnCommand>([
    { kind: 'complete', reason: 'done' },
    { kind: 'complete', reason: 'maxSteps' },
    { kind: 'interrupt' },
    { kind: 'fail', error: { message: 'boom', code: 'X' } },
  ])('终态 kind %o 投出对应 end 帧，且重复只投一帧', async (cmd) => {
    const { layers, framesFor } = makeHarness();
    await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        yield* t.claim('s1', { turnId: 1 });
        yield* t.transition('s1', cmd);
        yield* t.transition('s1', cmd);
      })
    );
    const ends = framesFor('s1').filter(
      (f) => f.family === 'transition' && f.transition.to === 'end'
    );
    expect(ends).toHaveLength(1);
  });

  it('start / running / compressing 投帧但不改变 running 状态', async () => {
    const { layers, framesFor } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        yield* t.claim('s1', { turnId: 3 });
        yield* t.transition('s1', { kind: 'start' });
        yield* t.transition('s1', { kind: 'running' });
        yield* t.transition('s1', { kind: 'compressing' });
        // 仍在 running ⇒ submit 命中
        return yield* t.submit('s1', input('x'));
      })
    );
    expect(result.kind).toBe('attached');
    const tos = framesFor('s1').map((f) => (f.family === 'transition' ? f.transition.to : f.family));
    expect(tos).toEqual(['start', 'executing', 'compress']);
  });

  it('wait：running 阻塞到终结并投影 completed', async () => {
    const { layers } = makeHarness();
    const outcome = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        yield* t.claim('s1', { turnId: 1 });
        // 稍后终结
        yield* Effect.forkDaemon(
          Effect.gen(function* () {
            yield* Effect.sleep(30);
            yield* t.transition('s1', { kind: 'complete', reason: 'done' });
          })
        );
        return yield* t.wait('s1', 5_000);
      })
    );
    expect(outcome).toBe('completed');
  });

  it('wait：已终态立即返回且可重复 wait', async () => {
    const { layers } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        yield* t.claim('s1', { turnId: 1 });
        yield* t.transition('s1', { kind: 'interrupt' });
        return { a: yield* t.wait('s1', 5_000), b: yield* t.wait('s1', 5_000) };
      })
    );
    expect(result.a).toBe('failed');
    expect(result.b).toBe('failed');
  });

  it('wait：未知 id 返回 undefined；超时返回 timeout', async () => {
    const { layers } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        const unknown = yield* t.wait('nope', 10);
        yield* t.claim('s1', { turnId: 1 });
        const timed = yield* t.wait('s1', 20);
        return { unknown, timed };
      })
    );
    expect(result.unknown).toBeUndefined();
    expect(result.timed).toBe('timeout');
  });

  it('有 parentSessionId 的记录在 markDelivered 之前不返回', async () => {
    const { layers } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        yield* t.claim('child', { turnId: 1, parentSessionId: 'parent' });
        yield* t.transition('child', { kind: 'complete', reason: 'done' });
        const before = yield* t.wait('child', 30);
        yield* t.markDelivered('child');
        const after = yield* t.wait('child', 5_000);
        return { before, after };
      })
    );
    expect(result.before).toBe('timeout');
    expect(result.after).toBe('completed');
  });

  it('settle 归属回收：父终结时清掉终态子记录、保留 running 子记录', async () => {
    const { layers } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        yield* t.claim('parent', { turnId: 1 });
        yield* t.claim('done-child', { turnId: 1, parentSessionId: 'parent' });
        yield* t.transition('done-child', { kind: 'complete', reason: 'done' });
        yield* t.claim('live-child', { turnId: 1, parentSessionId: 'parent' });
        yield* t.transition('parent', { kind: 'complete', reason: 'done' });
        // done-child 已被回收 ⇒ wait 返回 undefined
        return {
          doneChild: yield* t.wait('done-child', 10),
          liveChild: yield* t.wait('live-child', 10),
        };
      })
    );
    expect(result.doneChild).toBeUndefined();
    expect(result.liveChild).toBe('timeout');
  });

  it('runningChildren / stopChildren 只命中匹配父会话且 running 的记录', async () => {
    const { layers } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        const stopped: string[] = [];
        yield* t.claim('c1', { turnId: 1, parentSessionId: 'p1' });
        yield* t.claim('c2', { turnId: 1, parentSessionId: 'p1' });
        yield* t.claim('c3', { turnId: 1, parentSessionId: 'p2' });
        yield* t.arm('c1', () => stopped.push('c1'));
        yield* t.arm('c2', () => stopped.push('c2'));
        // 未 arm 的 c3 会被跳过
        const before = yield* t.runningChildren('p1');
        const stoppedCount = yield* t.stopChildren('p1');
        return { before, stoppedCount, stopped };
      })
    );
    expect(result.before).toBe(2);
    expect(result.stoppedCount).toBe(2);
    expect(result.stopped).toEqual(['c1', 'c2']);
  });

  it('dispose 同时清掉 parentSessionId 指向该会话的派生条目', async () => {
    const { layers } = makeHarness();
    const result = await run(
      layers,
      Effect.gen(function* () {
        const t = yield* TurnRegistryService;
        yield* t.claim('parent', { turnId: 1 });
        yield* t.claim('child', { turnId: 1, parentSessionId: 'parent' });
        yield* t.dispose('parent');
        return {
          parent: yield* t.wait('parent', 10),
          child: yield* t.wait('child', 10),
        };
      })
    );
    expect(result.parent).toBeUndefined();
    expect(result.child).toBeUndefined();
  });
});
